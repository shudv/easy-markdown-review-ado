// PrShell: document-level effects that follow the active comment thread.

import * as React from "react";

import type { ThreadState } from "../../comments/store";
import { events, track } from "../../telemetry";
import type { AnchorLayout } from "../components/ArticleView";
import { clearIfSet, isCommentUiClickTarget } from "../prShellHelpers";

type SetActiveThreadId = React.Dispatch<React.SetStateAction<string | null>>;

interface ActiveThreadEffectsOptions {
  activeThreadId: string | null;
  setActiveThreadId: SetActiveThreadId;
  dismissEmptyDraftRef: React.MutableRefObject<() => void>;
  initialActiveThreadId: string | undefined;
  onActiveThreadChange: ((threadId: string | null) => void) | undefined;
  selectedPath: string;
  threadState: ThreadState;
  prThreadSnapshots: number;
  renderVersion: number;
  anchorLayout: AnchorLayout;
}

/**
 * Document-level behaviour that follows the active comment thread: dismissal,
 * rail-follow scrolling, `?comment=` deep-link consumption, and reporting the
 * active thread up to the host.
 */
export function useActiveThreadEffects(opts: ActiveThreadEffectsOptions): void {
  useDismissActiveThread(opts.setActiveThreadId, opts.dismissEmptyDraftRef);
  useRailFollow(opts.activeThreadId);
  useCommentDeepLink(opts);
  useReportActiveThread(opts.activeThreadId, opts.onActiveThreadChange);
}

function useDismissActiveThread(
  setActiveThreadId: SetActiveThreadId,
  dismissEmptyDraftRef: React.MutableRefObject<() => void>,
): void {
  // ESC clears the active thread and dismisses an *empty* draft from anywhere
  // outside a text editor. A draft holding text is preserved (users must cancel
  // it explicitly). (Composer has its own ESC handler that stops propagation.)
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      /* v8 ignore next -- Escape inside a textarea/input is handled by the composer */
      if (target && target.matches("textarea, input")) return;
      setActiveThreadId(clearIfSet);
      dismissEmptyDraftRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setActiveThreadId, dismissEmptyDraftRef]);

  // Clicking outside a highlight, balloon, or selection bubble dismisses the
  // active thread and any *empty* draft — the priority-stacked layout is
  // strictly transient. A draft with text survives a stray click.
  React.useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      // A target that its own click handler removed from the DOM (e.g. a
      // mention-picker row that commits and unmounts) is detached by the time
      // this bubbles to document; `closest` can no longer see its `.emr-balloon`
      // ancestor. Such a click came from our own UI, so it must not dismiss.
      if (!target.isConnected || isCommentUiClickTarget(target)) return;
      setActiveThreadId(clearIfSet);
      dismissEmptyDraftRef.current();
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [setActiveThreadId, dismissEmptyDraftRef]);
}

function useRailFollow(activeThreadId: string | null): void {
  // When a thread becomes active, bring its balloon into view inside the rail's
  // OWN scroll (the rail scrolls independently of the document now). The
  // document is scrolled to the anchor by the selection handlers. One effect
  // centralises rail-follow for every activation path (click, cycle, deep link).
  React.useEffect(() => {
    if (!activeThreadId) return;
    const escaped = CSS.escape(activeThreadId);
    let cancelled = false;
    // rAF #1 lets React commit the list; rAF #2 lets layout settle.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        /* v8 ignore next -- bails if the active thread changed between rAFs */
        if (cancelled) return;
        /* v8 ignore next -- scrollIntoView is inert in headless tests */
        document
          .querySelector(
            `.emr-rail-col .emr-balloon[data-thread-id="${escaped}"]`,
          )
          // `start` + the balloon's `scroll-margin-top` (CSS) lands the comment
          // just below the sticky rail header, so its top is fully in view
          // instead of tucked under the "COMMENTS" strip.
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [activeThreadId]);
}

function useCommentDeepLink(opts: ActiveThreadEffectsOptions): void {
  const {
    initialActiveThreadId,
    setActiveThreadId,
    selectedPath,
    threadState,
    prThreadSnapshots,
    renderVersion,
    anchorLayout,
  } = opts;
  // Deep-link consumption (`?comment=`). Holds the thread to auto-open until
  // its anchor mounts — the linked document's threads may still be loading, or
  // the article may not have wrapped its highlights yet. Re-runs as the
  // document and thread set settle; once the anchor exists we activate +
  // center it and clear the seed so later navigation isn't hijacked.
  const pendingActiveThreadIdRef = React.useRef<string | undefined>(
    initialActiveThreadId,
  );
  React.useEffect(() => {
    // Latch the seed only when present. Hosts that gate the prop (e.g. the
    // Documents hub clears it after the first mount so it can't hijack later
    // navigation) flip it back to `undefined` on the next re-render — which
    // often lands BEFORE the linked document has finished its async render.
    // Overwriting the ref with that `undefined` would drop the deep link and
    // the thread would never auto-open. So we never clear it from props; the
    // consumption effect below clears it once the anchor is found.
    if (initialActiveThreadId) {
      pendingActiveThreadIdRef.current = initialActiveThreadId;
    }
  }, [initialActiveThreadId]);
  React.useEffect(() => {
    const tid = pendingActiveThreadIdRef.current;
    if (!tid) return;
    let cancelled = false;
    // One rAF lets React commit the current document + the highlight-wrapping
    // layout effect run, so the anchor (or balloon) is queryable.
    const handle = window.requestAnimationFrame(() => {
      /* v8 ignore next -- bails if the seed was consumed between frames */
      if (cancelled) return;
      // `tid` comes from the user-controlled `?comment=` route param, so escape
      // it before interpolating into a selector — metacharacters like `"` or
      // `]` would otherwise make `querySelector` throw and break deep linking.
      const escaped = CSS.escape(tid);
      let target: HTMLElement | null;
      try {
        target =
          document.querySelector<HTMLElement>(
            `.markdown-body [data-thread-id="${escaped}"]`,
          ) ??
          document.querySelector<HTMLElement>(
            `.emr-rail-col .emr-balloon[data-thread-id="${escaped}"]`,
          );
      } catch {
        /* v8 ignore next 2 -- defensive: CSS.escape yields a valid selector */
        return;
      }
      // Not mounted yet — leave the seed pending; a later threads/path change
      // or anchor re-resolution re-runs this effect once the linked document's
      // highlight has been wrapped into the DOM. But once a PR-wide thread
      // snapshot has arrived without it, the thread doesn't exist (deleted,
      // or a bad link): record that once and stop waiting.
      if (!target) {
        if (prThreadSnapshots > 0 && !threadState.threadsById[tid]) {
          pendingActiveThreadIdRef.current = undefined;
          track(events.linkOpened({ target: "comment", found: false }));
        }
        return;
      }
      pendingActiveThreadIdRef.current = undefined;
      setActiveThreadId(tid);
      track(events.linkOpened({ target: "comment", found: true }));
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(handle);
    };
    // `anchorLayout` is the signal that ArticleView has (re)wrapped the
    // highlight spans — `renderVersion`/`threadState` change when the document
    // or thread set settle, but the actual `[data-thread-id]` anchors land one
    // commit later via the async wrap pass. Depending on `anchorLayout` re-runs
    // this once the anchor is queryable, closing the deep-link race where the
    // rAF fired before the highlight existed.
  }, [
    selectedPath,
    threadState,
    prThreadSnapshots,
    renderVersion,
    anchorLayout,
    initialActiveThreadId,
    setActiveThreadId,
  ]);
}

function useReportActiveThread(
  activeThreadId: string | null,
  onActiveThreadChange: ((threadId: string | null) => void) | undefined,
): void {
  // Two-way deep-link binding: report the active thread up so the host can
  // mirror it into the route's `?comment=` param. The inverse of the
  // consumption effect above — selecting a comment yields the same shareable
  // URL the "Link to comment" action builds. Seeded to `null` (matching the
  // initial `activeThreadId`) so mount doesn't clobber a freshly-read deep
  // link with an empty param; only genuine changes (deep-link consumption,
  // selection, or clear) propagate.
  const lastReportedThreadRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!onActiveThreadChange) return;
    if (activeThreadId === lastReportedThreadRef.current) return;
    lastReportedThreadRef.current = activeThreadId;
    onActiveThreadChange(activeThreadId);
  }, [activeThreadId, onActiveThreadChange]);
}
