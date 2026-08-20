// Renders the Markdown HTML, then wraps each thread's anchor with a highlight
// span and measures its Y relative to the article-wrap. Reports Y positions and
// orphaned thread IDs to PrShell, and shows a floating "Add comment" bubble on
// text selection.

import * as React from "react";
import type { CommentThread, DiffRange, TextQuoteAnchor } from "../../types";
import { isResolvedLike } from "../../types";
import {
  captureAnchorFromSelection,
  resolveAnchor,
} from "../../comments/anchor";
import { wrapRangeWithHighlight } from "../../comments/highlight";
import {
  decorateDiffRanges,
  selectionTouchesDeletedDiff,
} from "../../markdown/diffDecorations";
import { renderMarkdownSync } from "../../markdown/render";
import { hydrateMermaid } from "../../markdown/mermaidHydrate";
import {
  hydrateDocumentImages,
  type RepositoryImageResolver,
} from "../../markdown/documentImages";
import {
  hydrateMentionLinks,
  MentionLinkContext,
} from "../../comments/mentionLinks";
import { SelectionBubble } from "./SelectionBubble";
import { MermaidSourceModal } from "./MermaidSourceModal";
import { persistSectionState, readSectionState } from "./navStorage";
import { events, track } from "../../telemetry";

export interface AnchorLayout {
  /** Map from thread id → top px (relative to article-wrap). */
  yByThreadId: Map<string, number>;
  /** Threads whose anchor could not be resolved in the current HTML. */
  orphanedThreadIds: string[];
}

interface ArticleViewProps {
  pristineHtml: string;
  /** Repository path of the Markdown document being rendered. */
  documentPath?: string;
  /** Reader font stack to bake into generated Mermaid SVG labels. */
  readerFontFamily?: string;
  threads: CommentThread[];
  activeThreadId: string | null;
  /** When set, render a yellow "draft" highlight at this anchor. */
  draftAnchor: TextQuoteAnchor | null;
  /** Class to add to highlights when the thread is in resolved/historical state. */
  onAnchorsResolved: (layout: AnchorLayout, draftY: number | null) => void;
  onHighlightClick: (threadId: string) => void;
  onSelection: (anchor: TextQuoteAnchor) => void;
  /** Persistence key (typically the current file path) for section state. */
  storageKey: string;
  /** Suppress the selection bubble (no commenting available). */
  readOnly?: boolean;
  /**
   * Changed source-line ranges for the current file. When provided (and
   * {@link showDiff} is not false) the article gets subtle change bars in
   * the left gutter plus deletion markers. Empty/undefined renders clean.
   */
  diff?: readonly DiffRange[];
  /** Complete Markdown source at the diff base commit for old-block reconstruction. */
  originalSource?: string;
  /** Complete current Markdown source for changes with no rendered DOM owner. */
  currentSource?: string;
  /** Toggle the diff decorations off without unmounting. Defaults to true. */
  showDiff?: boolean;
  /**
   * Called when the reader intercepts a click on an in-page/relative link. The
   * host resolves the `href` against the current document and navigates; it
   * returns `true` when it consumed the click (so the default is prevented) and
   * `false` for external links (https/mailto/mention…), which fall through to
   * the browser. Omitted in embeds that don't wire navigation.
   */
  onDocLink?: (href: string) => boolean;
  /** Resolve an in-repository image path to a browser-renderable object URL. */
  resolveDocumentImage?: RepositoryImageResolver;
}

const DRAFT_THREAD_ID = "__draft__";

export function ArticleView(props: ArticleViewProps): React.ReactElement {
  const {
    pristineHtml,
    documentPath,
    readerFontFamily,
    threads,
    activeThreadId,
    draftAnchor,
    onAnchorsResolved,
    onHighlightClick,
    onSelection,
    storageKey,
    readOnly = false,
    diff,
    originalSource,
    currentSource,
    showDiff = true,
    onDocLink,
    resolveDocumentImage,
  } = props;

  const wrapRef = React.useRef<HTMLDivElement>(null);
  const articleRef = React.useRef<HTMLDivElement>(null);
  const mentionCtx = React.useContext(MentionLinkContext);
  const [bubble, setBubble] = React.useState<{
    top: number;
    left: number;
    anchor: TextQuoteAnchor;
  } | null>(null);
  // Diagram whose "view source" was clicked; non-null = modal open. Carries an
  // optional `original` (the pre-PR diagram source) so the modal can show a
  // source-level diff when the diagram changed.
  const [mermaidSource, setMermaidSource] = React.useState<{
    source: string;
    original: string | null;
  } | null>(null);

  // Keep stable refs so the layout effect's dep array can stay simple.
  const callbacksRef = React.useRef({
    onAnchorsResolved,
    onHighlightClick,
    onSelection,
  });
  callbacksRef.current = { onAnchorsResolved, onHighlightClick, onSelection };

  // Build a stable signature so the wrap effect only re-runs when anchors change.
  const threadsKey = React.useMemo(
    () =>
      threads
        .map(
          (t) =>
            `${t.id}|${t.status}|${t.anchor.exact}|${t.anchor.prefix}|${t.anchor.suffix}`,
        )
        .join("\n"),
    [threads],
  );
  const draftKey = draftAnchor
    ? `${draftAnchor.exact}|${draftAnchor.prefix}|${draftAnchor.suffix}`
    : "";

  // Signature so the layout effect re-runs when the diff ranges (or the
  // show/hide toggle) change, without re-running on unrelated renders.
  const diffKey = React.useMemo(() => {
    if (!showDiff || !diff || diff.length === 0) return "";
    return diff.map((d) => `${d.kind}:${d.startLine}-${d.endLine}`).join(",");
  }, [diff, showDiff]);

  // -------------------------------------------------------------------------
  // Wrap pass: reset innerHTML, then wrap each anchor.
  // -------------------------------------------------------------------------
  React.useLayoutEffect(() => {
    const article = articleRef.current!;
    const wrap = wrapRef.current!;

    // Reset to pristine HTML — easiest way to undo previous wraps.
    article.innerHTML = pristineHtml;

    // Upgrade mention placeholder hrefs to real ADO web URLs before wrapping.
    hydrateMentionLinks(article, mentionCtx);
    const cleanupDocumentImages = resolveDocumentImage
      ? hydrateDocumentImages(
          article,
          documentPath ?? storageKey,
          resolveDocumentImage,
        )
      : undefined;

    // Hydrate persisted section collapse state BEFORE the wrap pass so the
    // measure step can detect hidden anchors and fall back to their heading y.
    const sections = article.querySelectorAll<HTMLElement>(".emr-section");
    sections.forEach((s) => {
      // The document-title section is never collapsible (it has no chevron),
      // so ignore any persisted state and keep it open.
      if (s.classList.contains("emr-section--doc-title")) {
        s.removeAttribute("data-collapsed");
        return;
      }
      const sid = s.dataset.sectionId;
      if (sid && readSectionState(storageKey, sid)) {
        s.setAttribute("data-collapsed", "true");
      } else {
        s.removeAttribute("data-collapsed");
      }
    });

    // Wrap each anchor with a highlight span; defer y measurement until all
    // wraps are done so section toggles can re-measure without re-wrapping.
    const wrapOne = (
      threadId: string,
      anchor: TextQuoteAnchor,
      classes: string,
    ): boolean => {
      const range = resolveAnchor(article, anchor);
      if (!range) return false;
      const spans = wrapRangeWithHighlight(range, {
        className: `emr-highlight ${classes}`.trim(),
        threadId,
      });
      return spans.length > 0;
    };

    const orphaned: string[] = [];
    for (const t of threads) {
      const cls = isResolvedLike(t.status) ? "is-resolved" : "";
      const ok = wrapOne(t.id, t.anchor, cls);
      if (!ok) orphaned.push(t.id);
    }

    let hasDraft = false;
    if (draftAnchor) {
      hasDraft = wrapOne(DRAFT_THREAD_ID, draftAnchor, "is-active");
    }

    // ---------------------------------------------------------------------
    // Diff decorations: gutter bars on changed blocks + deletion markers.
    // Applied AFTER the anchor wrap (block source-line attrs intact) and
    // BEFORE measureAll (a deletion marker shifts anchor y-positions).
    // ---------------------------------------------------------------------
    if (showDiff && diff && diff.length > 0) {
      decorateDiffRanges(article, diff, {
        renderInline: renderMarkdownSync,
        originalSource,
        currentSource,
      });
    }

    // ---------------------------------------------------------------------
    // Measure y of every wrapped highlight relative to the article-wrap.
    // Highlights in a collapsed section have a zero rect; for those we use
    // the section heading's y so balloons cluster at the section.
    // ---------------------------------------------------------------------
    function measureAll() {
      const wrapRect = wrap!.getBoundingClientRect();
      const yByThreadId = new Map<string, number>();
      let draftY: number | null = null;

      const seen = new Set<string>();
      const highlights =
        article!.querySelectorAll<HTMLElement>(".emr-highlight");
      highlights.forEach((el) => {
        const tid = el.dataset.threadId;
        if (!tid || seen.has(tid)) return;
        seen.add(tid);
        const rect = el.getBoundingClientRect();
        let y: number;
        if (rect.width === 0 && rect.height === 0) {
          // Hidden inside a collapsed section — fall back to heading y.
          const section = el.closest<HTMLElement>(".emr-section");
          const heading = section?.querySelector<HTMLElement>(
            "h1, h2, h3, h4, h5, h6",
          );
          /* v8 ignore next -- collapsed-section fallback geometry; headless layout gives zero rects */
          y = heading ? heading.getBoundingClientRect().top - wrapRect.top : 0;
        } else {
          y = rect.top - wrapRect.top;
        }
        if (tid === DRAFT_THREAD_ID) draftY = y;
        else yByThreadId.set(tid, y);
      });
      callbacksRef.current.onAnchorsResolved(
        { yByThreadId, orphanedThreadIds: orphaned },
        hasDraft ? draftY : null,
      );
    }

    measureAll();

    // Hydrate mermaid placeholders, then re-measure so balloons settle on the
    // rendered diagram's final height rather than the placeholder's.
    void hydrateMermaid(article, readerFontFamily).then(() => {
      if (!wrapRef.current) return;
      addMermaidSourceButtons(article);
      wrapRef.current.dispatchEvent(
        new CustomEvent("emr-sections-changed", { bubbles: false }),
      );
    });

    // Notify observers (DocNav badges, ChangeBar marks) that the wrap
    // completed, reusing the section-toggle event channel.
    wrap.dispatchEvent(
      new CustomEvent("emr-sections-changed", { bubbles: false }),
    );

    // Re-measure whenever sections collapse / expand.
    function onSectionsChanged() {
      measureAll();
    }
    wrap.addEventListener("emr-sections-changed", onSectionsChanged);
    return () => {
      wrap.removeEventListener("emr-sections-changed", onSectionsChanged);
      cleanupDocumentImages?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pristineHtml,
    documentPath,
    readerFontFamily,
    threadsKey,
    draftKey,
    storageKey,
    mentionCtx,
    diffKey,
    originalSource,
    currentSource,
    resolveDocumentImage,
  ]);

  // -------------------------------------------------------------------------
  // Mermaid follows the host theme. A rendered diagram bakes its colours in, so
  // when the reader flips light↔dark (`data-emr-theme` on <html>) the diagrams
  // must be re-hydrated to recolour. Font changes rerun the wrap effect above.
  // -------------------------------------------------------------------------
  React.useEffect(() => {
    const observer = new MutationObserver(() => {
      const article = articleRef.current;
      /* v8 ignore next -- the observer can fire after unmount clears the ref */
      if (!article) return;
      void hydrateMermaid(article, readerFontFamily).then(() => {
        /* v8 ignore next -- unmounted between hydrate start and resolve */
        if (!wrapRef.current) return;
        addMermaidSourceButtons(article);
        wrapRef.current.dispatchEvent(
          new CustomEvent("emr-sections-changed", { bubbles: false }),
        );
      });
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-emr-theme"],
    });
    return () => observer.disconnect();
  }, [readerFontFamily]);

  // -------------------------------------------------------------------------
  // Active class toggle (no re-wrap).
  // Layout effect (like the wrap pass above) so `is-active` is restored in the
  // same pre-paint phase — otherwise a re-wrap could paint one frame with the
  // active highlight missing before this ran.
  // -------------------------------------------------------------------------
  React.useLayoutEffect(() => {
    const article = articleRef.current!;
    const all = article.querySelectorAll<HTMLElement>(".emr-highlight");
    all.forEach((el) => {
      const tid = el.dataset.threadId!;
      // Draft is always rendered with is-active; don't toggle it off here.
      if (tid === DRAFT_THREAD_ID) return;
      if (tid === activeThreadId) el.classList.add("is-active");
      else el.classList.remove("is-active");
    });
    // Depends on the SAME signals as the wrap effect above (not just
    // activeThreadId): any re-wrap recreates the highlight spans fresh without
    // `is-active`, so this must re-run to re-apply it — otherwise a re-wrap
    // triggered by late-settling async data (diffKey/mentionCtx/originalSource)
    // silently drops the active highlight (the deep-link auto-activation race).
    // This effect is declared after the wrap effect, so on a shared commit it
    // runs second and re-applies the class onto the freshly wrapped spans.
  }, [
    activeThreadId,
    pristineHtml,
    threadsKey,
    draftKey,
    storageKey,
    mentionCtx,
    diffKey,
    originalSource,
  ]);

  // -------------------------------------------------------------------------
  // Click delegation on highlights AND section headings (collapse toggle),
  // sharing one listener. The heading branch yields when a text selection
  // exists so users can still select+comment heading text.
  // -------------------------------------------------------------------------
  const onClick = React.useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;

      // Relative in-repo doc link (or in-page #anchor) — let the host resolve +
      // navigate instead of the iframe following a dead relative URL. The host
      // returns false for external links (https/mailto/mention…), which then
      // fall through to the browser's default handling.
      if (onDocLink) {
        const link = target.closest<HTMLElement>("a[href]");
        if (link && onDocLink(link.getAttribute("href")!)) {
          e.preventDefault();
          return;
        }
      }

      // 0) Mermaid "view source" affordance — open the source modal.
      const mermaidBtn = target.closest<HTMLElement>(".emr-mermaid-source-btn");
      if (mermaidBtn) {
        e.preventDefault();
        const block = mermaidBtn.closest<HTMLElement>(".emr-mermaid");
        const enc = block?.getAttribute("data-mermaid-src");
        // A changed diagram stashes its pre-PR source here (see diffDecorations).
        const original = block?.dataset.diffOriginal ?? null;
        /* v8 ignore next -- enc is always present on a mermaid block; guard is defensive */
        if (enc) {
          let source = enc;
          try {
            source = decodeURIComponent(enc);
          } catch {
            /* v8 ignore next -- decode only throws on malformed input */
            source = enc;
          }
          setMermaidSource({ source, original });
          track(events.mermaidSourceViewed({ changed: original !== null }));
        }
        return;
      }

      // 1) Section-heading toggle. Skipped when a non-empty selection exists
      //    (selection bubble wins) or the click hit an inline link / button.
      const heading = target.closest<HTMLElement>(
        ".emr-section > h1, .emr-section > h2, .emr-section > h3, .emr-section > h4, .emr-section > h5, .emr-section > h6",
      );
      if (heading && !target.closest("a, button, input, label")) {
        const sel = window.getSelection();
        /* v8 ignore next -- selection-present branch defers to the bubble; headless clicks carry no selection */
        if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
          // Defer to selection bubble; do not toggle.
        } else {
          const section = heading.parentElement as HTMLElement | null;
          /* v8 ignore next -- heading is always inside an .emr-section; guard is defensive */
          if (
            section?.classList.contains("emr-section") &&
            // The document-title section wraps the whole doc; folding it is
            // meaningless, so it carries no chevron and ignores clicks.
            !section.classList.contains("emr-section--doc-title")
          ) {
            /* v8 ignore next -- sectionId is always set by the renderer; "" fallback is defensive */
            const sid = section.dataset.sectionId ?? "";
            const wasCollapsed =
              section.getAttribute("data-collapsed") === "true";
            if (wasCollapsed) section.removeAttribute("data-collapsed");
            else section.setAttribute("data-collapsed", "true");
            /* v8 ignore next -- sid is always non-empty here; guard mirrors the defensive fallback above */
            if (sid) persistSectionState(storageKey, sid, !wasCollapsed);
            // Re-measure anchors after the toggle.
            wrapRef.current?.dispatchEvent(
              new CustomEvent("emr-sections-changed", { bubbles: false }),
            );
            return;
          }
        }
      }

      // 2) Highlight click — open the matching thread.
      const hl = target.closest<HTMLElement>(".emr-highlight");
      if (!hl) return;
      const tid = hl.dataset.threadId;
      if (!tid || tid === DRAFT_THREAD_ID) return;
      callbacksRef.current.onHighlightClick(tid);
    },
    [storageKey, onDocLink],
  );

  // -------------------------------------------------------------------------
  // Selection capture: on mouseup, show the floating bubble above a non-empty
  // selection inside the article.
  // -------------------------------------------------------------------------
  const onMouseUp = React.useCallback(() => {
    if (readOnly) return;
    // Wait for the selection to settle (click can clear it).
    window.requestAnimationFrame(() => {
      const article = articleRef.current!;
      const wrap = wrapRef.current!;
      const anchor = captureAnchorFromSelection(article);
      if (!anchor) {
        setBubble(null);
        return;
      }
      const sel = window.getSelection();
      /* v8 ignore next -- selection persists between capture and re-read */
      if (!sel || sel.rangeCount === 0) return;
      // Removed (deleted-diff) content is shown for reference only; it isn't
      // part of the document, so a comment anchored there orphans immediately.
      // Don't offer the bubble when the selection lands in a deletion marker.
      if (selectionTouchesDeletedDiff(sel.anchorNode, sel.focusNode)) {
        setBubble(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      // Approx bubble width (button label + chrome). Used to clamp horizontal.
      const BUBBLE_W = 132;
      const desiredTop = rect.top - wrapRect.top - 36;
      const desiredLeft =
        rect.left + rect.width / 2 - wrapRect.left - BUBBLE_W / 2;
      setBubble({
        anchor,
        // Don't render above the article. If selection is at the very top,
        // tuck the bubble just below it instead of off-screen.
        /* v8 ignore next -- top-of-article clamp; headless getBoundingClientRect yields zeros */
        top: desiredTop < 4 ? rect.bottom - wrapRect.top + 8 : desiredTop,
        // Clamp horizontally so the bubble always fully fits inside wrap.
        left: Math.max(4, Math.min(desiredLeft, wrapRect.width - BUBBLE_W - 4)),
      });
    });
  }, [readOnly]);

  // Clear bubble if user clicks elsewhere or selection collapses.
  React.useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      // If click is inside the bubble, ignore (its own button handler runs).
      const target = e.target as HTMLElement;
      if (target.closest(".emr-selection-bubble")) return;
      setBubble(null);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  return (
    <div className="emr-article-wrap" ref={wrapRef}>
      <div
        ref={articleRef}
        className="markdown-body emr-rendered"
        onClick={onClick}
        onMouseUp={onMouseUp}
      />
      {bubble ? (
        <SelectionBubble
          top={bubble.top}
          left={bubble.left}
          onAddComment={() => {
            const a = bubble.anchor;
            setBubble(null);
            // Collapse selection so the highlight is visible.
            window.getSelection()?.removeAllRanges();
            callbacksRef.current.onSelection(a);
          }}
        />
      ) : null}
      <MermaidSourceModal
        source={mermaidSource?.source ?? null}
        originalSource={mermaidSource?.original ?? null}
        onClose={() => setMermaidSource(null)}
      />
    </div>
  );
}

/**
 * Inject a "</> Source" button into every hydrated Mermaid block that
 * doesn't already have one. Called after `hydrateMermaid` resolves so the
 * SVG is in place. The button reads the diagram source back from the
 * placeholder's `data-mermaid-src` attribute (which hydration leaves
 * intact), so no extra state plumbing is needed.
 */
function addMermaidSourceButtons(root: HTMLElement): void {
  const blocks = root.querySelectorAll<HTMLElement>(
    ".emr-mermaid[data-mermaid-src]",
  );
  blocks.forEach((block) => {
    /* v8 ignore next -- innerHTML reset removes prior buttons before each pass */
    if (block.querySelector(":scope > .emr-mermaid-source-btn")) return;
    if (block.getAttribute("data-mermaid-error")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "emr-mermaid-source-btn";
    btn.title = "View diagram source";
    btn.textContent = "</> Source";
    block.appendChild(btn);
  });
}
