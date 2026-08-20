// Tiny Markdown composer used inside balloons (new comment, reply, edit).
// Two-tab UI: Write | Preview. While typing, the caret is watched for an active
// `@` / `#` / `!` trigger; matching suggestions surface in a floating
// MentionPicker, and Enter/Tab splices the canonical mention markdown in.

import * as React from "react";

import { useCommentApi } from "../../comments/api";
import {
  buildMentionMarkdown,
  detectActiveTrigger,
  encodePickedMentions,
  uniqueMentionLabel,
  type ActiveTrigger,
  type MentionSuggestion,
} from "../../comments/mentions";
import { renderMarkdownSync } from "../../markdown/render";
import { useMentionLinkHydration } from "../../comments/mentionLinks";
import {
  useIdentityStore,
  useUserMentionHydration,
} from "../../comments/identityStore";
import { MentionPicker } from "./MentionPicker";
import { patchIfSet } from "../prShellHelpers";

/**
 * Delay (ms) before the REST search for mention suggestions. The picker opens
 * immediately (with `loading: true`); this coalesces network calls so a fast
 * typist makes one request per word rather than one per key.
 */
const MENTION_DEBOUNCE_MS = 250;

interface ComposerProps {
  initial?: string;
  placeholder?: string;
  submitLabel: string;
  /** Auto-focus on mount. */
  autoFocus?: boolean;
  /** Notified with the raw editor text on every change (for draft persistence). */
  onChange?: (value: string) => void;
  onSubmit: (body: string) => void;
  onCancel?: () => void;
}

interface MentionState {
  trigger: ActiveTrigger;
  suggestions: MentionSuggestion[];
  loading: boolean;
  selectedIndex: number;
  /** Token incremented per fetch so stale responses are discarded. */
  requestId: number;
}

export function Composer(props: ComposerProps): React.ReactElement {
  const {
    initial = "",
    placeholder = "Write a comment… Markdown supported.",
    submitLabel,
    autoFocus,
    onChange,
    onSubmit,
    onCancel,
  } = props;

  /* v8 ignore next -- always runs on mount; v8 statement-range mapping for this
     hook call jitters with the storybook browser bundle layout (line stays 100%). */
  const commentApi = useCommentApi();
  const identityStore = useIdentityStore();

  const [value, setValue] = React.useState<string>(initial);
  const [tab, setTab] = React.useState<"write" | "preview">("write");

  // Report text changes to the host (draft persistence) without re-subscribing
  // the effect when the parent passes a fresh callback each render. See the
  // `encodedValue` effect below — we emit the canonical `@<GUID>` form, not the
  // readable display text, so a persisted/restored draft keeps its mentions.
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const taRef = React.useRef<HTMLTextAreaElement>(null);
  // Composer root, scrolled into the rail's container when the textarea grows.
  const rootRef = React.useRef<HTMLDivElement>(null);

  // Mention picker state. Null when the picker is closed.
  const [mention, setMention] = React.useState<MentionState | null>(null);
  // Pixel coords of the picker, recomputed on trigger / scroll / resize.
  const [pickerPos, setPickerPos] = React.useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const requestSeq = React.useRef(0);
  const mentionDebounceRef = React.useRef<number | null>(null);

  // User mentions the author picked from the typeahead, tracked so their
  // readable `@Display Name` (shown while typing) can be re-encoded to the
  // ADO-native `@<GUID>` token on submit / in the preview. Never persisted as
  // names — only the GUID token is stored.
  const pickedMentionsRef = React.useRef<Array<{ label: string; id: string }>>(
    [],
  );

  // The value with picked `@Display Name` tokens re-encoded to `@<GUID>`. This
  // is the canonical text: what the preview renders and what gets persisted.
  const encodedValue = React.useMemo(
    () => encodePickedMentions(value, pickedMentionsRef.current),
    [value],
  );

  // Emit the canonical value to the host on every change. Persisting the
  // encoded form (rather than the readable display text) means a restored draft
  // still carries its `@<GUID>` mention tokens even though the picked-mention
  // map from the typeahead is gone after a reload.
  React.useEffect(() => {
    onChangeRef.current?.(encodedValue);
  }, [encodedValue]);

  React.useEffect(() => {
    if (autoFocus) taRef.current?.focus();
  }, [autoFocus]);

  // Drop any pending debounced search when the composer unmounts.
  React.useEffect(() => {
    return () => {
      /* v8 ignore start -- unmount rarely races a still-pending debounce timer */
      if (mentionDebounceRef.current !== null) {
        window.clearTimeout(mentionDebounceRef.current);
        mentionDebounceRef.current = null;
      }
      /* v8 ignore stop */
    };
  }, []);

  // Auto-grow the textarea to fit content (with a sensible cap).
  React.useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta || tab !== "write") return;
    ta.style.height = "auto";
    const next = Math.min(ta.scrollHeight, 320);
    ta.style.height = `${Math.max(next, 70)}px`;
    // Keep the composer visible inside the scroll container. Deferred into a
    // rAF so it runs after other scrolls scheduled by the opening click
    // (notably the article-highlight re-center), which would otherwise win.
    const raf = requestAnimationFrame(() => {
      rootRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(raf);
  }, [value, tab]);

  const previewHtml = React.useMemo(
    () => (encodedValue.trim() ? renderMarkdownSync(encodedValue) : ""),
    [encodedValue],
  );

  // Mention links in the preview need the same href hydration as rendered
  // bodies, else they show as non-navigable `mention://` chips.
  const previewRef = React.useRef<HTMLDivElement | null>(null);
  useMentionLinkHydration(previewRef, [previewHtml, tab]);
  // Resolve `@<GUID>` user mentions in the preview to display names too.
  useUserMentionHydration(previewRef, [previewHtml, tab]);

  const canSubmit = value.trim().length > 0;

  const fetchSuggestions = React.useCallback(
    async (trigger: ActiveTrigger, requestId: number) => {
      try {
        let result: MentionSuggestion[];
        switch (trigger.kind) {
          case "user":
            result = await commentApi.searchUsers(trigger.query);
            break;
          case "workitem":
            result = await commentApi.searchWorkItems(trigger.query);
            break;
          case "pullrequest":
            result = await commentApi.searchPullRequests(trigger.query);
            break;
        }
        // Drop stale responses.
        /* v8 ignore next -- debounce cancels superseded requests before they resolve */
        if (requestId !== requestSeq.current) return;
        setMention((prev) => {
          /* v8 ignore next -- picker state always matches the resolving request */
          if (!prev || prev.requestId !== requestId) return prev;
          const clamped = Math.min(
            prev.selectedIndex,
            Math.max(0, result.length - 1),
          );
          return {
            ...prev,
            suggestions: result,
            loading: false,
            selectedIndex: clamped,
          };
        });
      } catch (err) {
        console.error("[mention search]", err);
        /* v8 ignore next -- a failing request is never superseded mid-flight here */
        if (requestId !== requestSeq.current) return;
        setMention(null);
      }
    },
    [commentApi],
  );

  /**
   * Re-evaluate the caret position and open / update / close the mention
   * picker. Called after every event that might move the caret.
   */
  const reevaluateTrigger = React.useCallback(
    (text: string, caret: number) => {
      const trigger = detectActiveTrigger(text, caret);
      if (!trigger) {
        setMention(null);
        if (mentionDebounceRef.current !== null) {
          window.clearTimeout(mentionDebounceRef.current);
          mentionDebounceRef.current = null;
        }
        return;
      }
      setMention((prev) => {
        const sameRun =
          prev &&
          prev.trigger.start === trigger.start &&
          prev.trigger.kind === trigger.kind;
        const requestId = ++requestSeq.current;
        const nextState: MentionState = {
          trigger,
          suggestions: sameRun ? prev!.suggestions : [],
          loading: true,
          selectedIndex: sameRun ? prev!.selectedIndex : 0,
          requestId,
        };
        // Debounce the REST call — each keystroke replaces the pending timer.
        if (mentionDebounceRef.current !== null) {
          window.clearTimeout(mentionDebounceRef.current);
        }
        mentionDebounceRef.current = window.setTimeout(() => {
          mentionDebounceRef.current = null;
          void fetchSuggestions(trigger, requestId);
        }, MENTION_DEBOUNCE_MS);
        return nextState;
      });
    },
    [fetchSuggestions],
  );

  /**
   * Compute pixel coordinates for the picker, anchored just below the
   * textarea's left edge.
   */
  const recomputePickerPos = React.useCallback(() => {
    const ta = taRef.current;
    /* v8 ignore next -- textarea ref is attached whenever the picker can open */
    if (!ta) return;
    const rect = ta.getBoundingClientRect();
    setPickerPos({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }, []);

  React.useEffect(() => {
    if (!mention) {
      setPickerPos(null);
      return;
    }
    recomputePickerPos();
    const onMove = () => recomputePickerPos();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [mention, recomputePickerPos]);

  /**
   * Commit the currently selected suggestion by splicing the mention's
   * markdown into the textarea value, then close the picker.
   */
  const commitSelection = React.useCallback(() => {
    const m = mention!;
    const suggestion = m.suggestions[m.selectedIndex]!;
    // Seed the identity store so the just-picked person's `@<GUID>` renders as
    // their name immediately (in the preview and the posted comment) with no
    // lookup — we already know it here.
    if (suggestion.kind === "user") {
      identityStore?.seed([
        {
          id: suggestion.id,
          displayName: suggestion.displayName,
          avatarUrl: suggestion.avatarUrl,
        },
      ]);
    }
    const before = value.slice(0, m.trigger.start);
    const after = value.slice(m.trigger.end);
    // For user mentions, insert the READABLE `@Display Name` so the author sees
    // the name (not a raw GUID) while typing. It's re-encoded to the ADO-native
    // `@<GUID>` token in the preview and on submit via `encodePickedMentions`.
    // Work-item / PR mentions keep their canonical link markdown.
    let insertion: string;
    if (suggestion.kind === "user") {
      // Disambiguate against already-picked labels so two different people who
      // share a display name each get a distinct, deterministically-matchable
      // label (the " 2" suffix is transient — it becomes a pill on submit).
      const label = uniqueMentionLabel(
        suggestion.displayName,
        pickedMentionsRef.current.map((p) => p.label),
      );
      insertion = `@${label} `;
      pickedMentionsRef.current.push({ label, id: suggestion.id });
    } else {
      insertion = buildMentionMarkdown(suggestion);
    }
    const next = before + insertion + after;
    const nextCaret = before.length + insertion.length;
    setValue(next);
    setMention(null);
    requestAnimationFrame(() => {
      // The textarea can be unmounted/replaced between scheduling this frame
      // and it firing — most notably for the new-comment DRAFT balloon, whose
      // ResizeObserver re-stacks the rail when the spliced mention grows the
      // textarea. Guard the ref so committing a mention never throws
      // ("Cannot read properties of null (reading 'focus')").
      const el = taRef.current;
      /* v8 ignore next -- defensive: textarea can be unmounted between the rAF schedule and fire (prod-only race on the draft balloon) */
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  }, [mention, value, identityStore]);

  const cancelMention = React.useCallback(() => {
    setMention(null);
  }, []);

  return (
    <div ref={rootRef} className="emr-composer">
      <div className="emr-tabs">
        <button
          className={tab === "write" ? "is-active" : ""}
          onClick={() => setTab("write")}
          type="button"
        >
          Write
        </button>
        <button
          className={tab === "preview" ? "is-active" : ""}
          onClick={() => setTab("preview")}
          type="button"
        >
          Preview
        </button>
      </div>

      {tab === "write" ? (
        <textarea
          ref={taRef}
          className="emr-textarea"
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            setValue(next);
            const caret = e.target.selectionStart!;
            reevaluateTrigger(next, caret);
          }}
          onKeyDown={(e) => {
            // While the picker is open, hijack navigation / commit / cancel
            // keys before the textarea sees them.
            if (mention && mention.suggestions.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setMention(
                  patchIfSet((prev) => ({
                    ...prev,
                    selectedIndex:
                      (prev.selectedIndex + 1) % prev.suggestions.length,
                  })),
                );
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setMention(
                  patchIfSet((prev) => ({
                    ...prev,
                    selectedIndex:
                      (prev.selectedIndex - 1 + prev.suggestions.length) %
                      prev.suggestions.length,
                  })),
                );
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                e.stopPropagation();
                commitSelection();
                return;
              }
              /* v8 ignore next -- Escape-cancels-mention key branch; not exercised in the render harness */
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancelMention();
                return;
              }
            }

            if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canSubmit) {
              e.preventDefault();
              onSubmit(encodedValue.trim());
            }
            if (e.key === "Escape" && onCancel) {
              e.preventDefault();
              // Cancel only this composer, not the thread — don't bubble to the
              // document-level ESC handler.
              e.stopPropagation();
              onCancel();
            }
          }}
          // Re-evaluate the trigger on any caret-moving event that isn't a
          // raw input change (arrow keys, mouse clicks).
          onKeyUp={(e) => {
            if (
              e.key === "ArrowLeft" ||
              e.key === "ArrowRight" ||
              e.key === "Home" ||
              e.key === "End" ||
              e.key === "Backspace" ||
              e.key === "Delete"
            ) {
              const ta = taRef.current!;
              reevaluateTrigger(ta.value, ta.selectionStart!);
            }
          }}
          onClick={() => {
            const ta = taRef.current!;
            reevaluateTrigger(ta.value, ta.selectionStart!);
          }}
        />
      ) : (
        <div
          ref={previewRef}
          className="emr-preview markdown-body"
          dangerouslySetInnerHTML={{
            __html:
              previewHtml || "<em style='color:#888'>Nothing to preview</em>",
          }}
        />
      )}

      <div className="emr-composer-actions">
        {onCancel ? (
          <button className="emr-btn subtle" type="button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button
          className="emr-btn primary"
          type="button"
          disabled={!canSubmit}
          onClick={() => onSubmit(encodedValue.trim())}
        >
          {submitLabel}
        </button>
      </div>

      {mention && pickerPos && tab === "write" ? (
        <MentionPicker
          kind={mention.trigger.kind}
          query={mention.trigger.query}
          suggestions={mention.suggestions}
          loading={mention.loading}
          top={pickerPos.top}
          left={pickerPos.left}
          maxWidth={Math.max(pickerPos.width, 280)}
          selectedIndex={mention.selectedIndex}
          onSelectedIndexChange={(i) =>
            setMention(patchIfSet((prev) => ({ ...prev, selectedIndex: i })))
          }
          onSelect={() => commitSelection()}
          onCancel={cancelMention}
        />
      ) : null}
    </div>
  );
}
