// Renders the Markdown HTML, then wraps each thread's anchor with a highlight
// span and measures its Y relative to the article-wrap. Reports Y positions and
// orphaned thread IDs to PrShell, and shows a floating "Add comment" bubble on
// text selection.

import * as React from "react";
import type { CommentThread, DiffRange, TextQuoteAnchor } from "../../types";
import { captureAnchorFromSelection } from "../../comments/anchor";
import {
  decorateDiffRanges,
  selectionTouchesDeletedDiff,
} from "../../markdown/diffDecorations";
import { renderMarkdownSync } from "../../markdown/render";
import { hydrateMermaid } from "../../markdown/mermaidHydrate";
import { hydrateMath } from "../../markdown/mathHydrate";
import {
  hydrateDocumentImages,
  type RepositoryImageResolver,
} from "../../markdown/documentImages";
import {
  hydrateMentionLinks,
  MentionLinkContext,
} from "../../comments/mentionLinks";
import { GeneratedSourceModal } from "./GeneratedSourceModal";
import type {
  AnchorLayout,
  CommentBlock,
  SelectionLinkTarget,
} from "./ArticleView.types";
import { HEADING_LINK_CLASS } from "./ArticleView.headingLinks";
import {
  addHighlightKeyboardTargets,
  containedThreadIds,
  DRAFT_THREAD_ID,
  syncActiveHighlights,
  syncHoveredHighlights,
} from "./ArticleView.highlights";
import {
  addGeneratedSourceButtons,
  type GeneratedSourceView,
} from "./ArticleView.generatedSource";
import {
  handleDocLinkClick,
  handleGeneratedSourceClick,
  handleHeadingLinkClick,
  handleSectionToggleClick,
  nextClickedThreadId,
} from "./ArticleView.clicks";
import {
  ArticleSelectionBubble,
  selectionBubblePosition,
  selectionBubbleWidth,
  selectionLinkTarget,
  type SelectionBubbleState,
} from "./ArticleView.selectionBubble";
import {
  anchorSignature,
  focusedDatasetValue,
  hasVisibleDiff,
  hydrateSections,
  measureAnchorYs,
  restoreRewrapFocus,
  wrapAnchors,
} from "./ArticleView.wrap";

export type { AnchorLayout, SelectionLinkTarget } from "./ArticleView.types";

interface ArticleViewProps {
  pristineHtml: string;
  /** Repository path of the Markdown document being rendered. */
  documentPath?: string;
  /** Reader font stack to bake into generated Mermaid SVG labels. */
  readerFontFamily?: string;
  threads: CommentThread[];
  activeThreadId: string | null;
  /** When set, render the selected comment-anchor treatment at this anchor. */
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
  /**
   * Copy a shareable link to the heading with this id. When provided, every
   * section heading gets a hover/focus "Copy link to section" button; it
   * resolves to whether the copy succeeded so the button can confirm. Omitted
   * on surfaces with no shareable URL (the button is then not rendered).
   */
  onCopyHeadingLink?: (headingId: string) => Promise<boolean>;
  /**
   * Copy a shareable link to selected text: the serialized text fragment
   * (`?text=`) plus the enclosing heading's id as a fallback. When provided the
   * selection bubble gets a "Copy link to selection" action — also on
   * read-only surfaces, where it is the bubble's only action. Resolves to
   * whether the copy succeeded.
   */
  onCopySelectionLink?: (target: SelectionLinkTarget) => Promise<boolean>;
  /**
   * Checked when text is selected: return a reason (with a way forward) when
   * a comment can't be attached to the selection — e.g. comparing an earlier
   * PR update where the text no longer exists in the latest version. The
   * selection bubble then explains instead of offering "Add comment".
   */
  commentBlocker?: (anchor: TextQuoteAnchor) => CommentBlock | null;
}

// eslint-disable-next-line max-lines-per-function -- Rendered article: owns the DOM refs that highlight wrapping, selection and click delegation act on. Effect bodies and handlers are extracted; the component wires them to one element tree.
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
    onCopyHeadingLink,
    onCopySelectionLink,
    commentBlocker,
  } = props;
  const hasHeadingLinks = onCopyHeadingLink !== undefined;
  const hasSelectionLinks = onCopySelectionLink !== undefined;

  const wrapRef = React.useRef<HTMLDivElement>(null);
  const articleRef = React.useRef<HTMLDivElement>(null);
  const mentionCtx = React.useContext(MentionLinkContext);
  // Polite announcement for the heading link button's copy outcome (the
  // button's own label change is not reliably announced).
  const [linkAnnouncement, setLinkAnnouncementText] = React.useState("");
  const setLinkAnnouncement = React.useCallback((text: string) => {
    // Clear first so repeating the same outcome is announced again.
    setLinkAnnouncementText("");
    window.requestAnimationFrame(() => setLinkAnnouncementText(text));
  }, []);
  const [bubble, setBubble] = React.useState<SelectionBubbleState | null>(null);
  // Generated block whose Source action was clicked. `original` carries the
  // pre-PR source so the modal can show an internal source-level diff.
  const [generatedSource, setGeneratedSource] =
    React.useState<GeneratedSourceView | null>(null);

  // Keep stable refs so the layout effect's dep array can stay simple.
  const callbacksRef = React.useRef({
    onAnchorsResolved,
    onHighlightClick,
    onSelection,
    commentBlocker,
  });
  callbacksRef.current = {
    onAnchorsResolved,
    onHighlightClick,
    onSelection,
    commentBlocker,
  };

  // Build a stable signature so the wrap effect only re-runs when anchors change.
  const threadsKey = React.useMemo(
    () =>
      threads
        .map((t) => `${t.id}|${t.status}|${anchorSignature(t.anchor)}`)
        .join("\n"),
    [threads],
  );
  const draftKey = draftAnchor ? anchorSignature(draftAnchor) : "";
  const previousActiveThreadIdRef = React.useRef<string | null>(null);

  // Signature so the layout effect re-runs when the diff ranges (or the
  // show/hide toggle) change, without re-running on unrelated renders.
  const diffKey = React.useMemo(() => {
    if (!hasVisibleDiff(showDiff, diff)) return "";
    return diff.map((d) => `${d.kind}:${d.startLine}-${d.endLine}`).join(",");
  }, [diff, showDiff]);

  // -------------------------------------------------------------------------
  // Wrap pass: reset innerHTML, then wrap each anchor.
  // -------------------------------------------------------------------------
  React.useLayoutEffect(() => {
    const article = articleRef.current!;
    const wrap = wrapRef.current!;
    const focusedThreadId = focusedDatasetValue(
      article,
      '.emr-highlight[role="button"]',
      "threadId",
    );
    // A keyboard user on a heading link button keeps their place when a
    // thread poll / diff / image load re-wraps the article.
    const focusedHeadingLinkId = focusedDatasetValue(
      article,
      `.${HEADING_LINK_CLASS}`,
      "headingId",
    );

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
    hydrateSections(article, storageKey, hasHeadingLinks);

    // Wrap each anchor with a highlight span; defer y measurement until all
    // wraps are done so section toggles can re-measure without re-wrapping.
    const { orphaned, hasDraft } = wrapAnchors(article, threads, draftAnchor);

    addHighlightKeyboardTargets(article);

    // ---------------------------------------------------------------------
    // Diff decorations: gutter bars on changed blocks + deletion markers.
    // Applied AFTER the anchor wrap (block source-line attrs intact) and
    // BEFORE measureAll (a deletion marker shifts anchor y-positions).
    // ---------------------------------------------------------------------
    if (hasVisibleDiff(showDiff, diff)) {
      decorateDiffRanges(article, diff, {
        renderInline: renderMarkdownSync,
        originalSource,
        currentSource,
      });
    }

    // Rewraps create fresh spans, so restore selection without replaying the
    // transient landing cue. The active-thread effect owns that animation.
    syncActiveHighlights(article, activeThreadId, false);
    restoreRewrapFocus(article, focusedThreadId, focusedHeadingLinkId);

    // Measure y of every wrapped highlight relative to the article-wrap (see
    // `measureAnchorYs`) and report the layout.
    function measureAll() {
      const { yByThreadId, draftY } = measureAnchorYs(wrap, article);
      callbacksRef.current.onAnchorsResolved(
        { yByThreadId, orphanedThreadIds: orphaned },
        hasDraft ? draftY : null,
      );
    }

    measureAll();

    // Hydrate generated media, then re-measure so balloons settle on the final
    // rendered height rather than the readable source fallbacks.
    void Promise.all([
      hydrateMermaid(article, readerFontFamily),
      hydrateMath(article),
    ]).then(() => {
      if (!wrapRef.current) return;
      addGeneratedSourceButtons(article);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on threadsKey/draftKey/diffKey rather than the objects, so the costly rewrap runs only when content changes; selection and focus have their own effects
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
    hasHeadingLinks,
  ]);

  // -------------------------------------------------------------------------
  // Mermaid follows the host theme. A rendered diagram bakes its colours in, so
  // when the reader flips light↔dark (`data-emr-theme` on <html>) the diagrams
  // must be re-hydrated to recolour. Font changes rerun the wrap effect above.
  // -------------------------------------------------------------------------
  React.useEffect(() => {
    const observer = new MutationObserver(() => {
      const article = articleRef.current;
      /* v8 ignore next -- the article div is always rendered, and unmount disconnects this observer, which discards queued records, so the ref is never null here */
      if (!article) return;
      void hydrateMermaid(article, readerFontFamily).then(() => {
        if (!wrapRef.current) return;
        addGeneratedSourceButtons(article);
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
  // Active thread changes do not rewrap the article. Synchronize the persistent
  // selection and play one landing cue on the newly active range.
  // -------------------------------------------------------------------------
  React.useLayoutEffect(() => {
    const activeChanged =
      activeThreadId !== null &&
      activeThreadId !== previousActiveThreadIdRef.current;
    syncActiveHighlights(articleRef.current!, activeThreadId, activeChanged);
    previousActiveThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  // -------------------------------------------------------------------------
  // Click delegation on highlights AND section headings (collapse toggle),
  // sharing one listener. The heading branch yields when a text selection
  // exists so users can still select+comment heading text.
  // -------------------------------------------------------------------------
  const onClick = React.useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (handleDocLinkClick(e, target, onDocLink)) return;
      if (handleGeneratedSourceClick(e, target, setGeneratedSource)) return;
      if (
        handleHeadingLinkClick(
          e,
          target,
          onCopyHeadingLink,
          setLinkAnnouncement,
        )
      ) {
        return;
      }
      if (handleSectionToggleClick(target, storageKey, wrapRef)) return;
      const threadId = nextClickedThreadId(
        target,
        articleRef.current,
        activeThreadId,
      );
      if (threadId === null) return;
      syncHoveredHighlights(articleRef.current!, null);
      callbacksRef.current.onHighlightClick(threadId);
    },
    [
      storageKey,
      onDocLink,
      activeThreadId,
      onCopyHeadingLink,
      setLinkAnnouncement,
    ],
  );

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>(
        '.emr-highlight[role="button"]',
      );
      if (!target) return;
      if (event.key === " ") {
        event.preventDefault();
        return;
      }
      if (event.key !== "Enter" || event.repeat) return;
      const threadIds = containedThreadIds(target);
      event.preventDefault();
      const activeIndex = threadIds.indexOf(activeThreadId ?? "");
      callbacksRef.current.onHighlightClick(
        threadIds[(activeIndex + 1) % threadIds.length]!,
      );
    },
    [activeThreadId],
  );

  const onKeyUp = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== " ") return;
      const target = (event.target as HTMLElement).closest<HTMLElement>(
        '.emr-highlight[role="button"]',
      );
      if (!target) return;
      event.preventDefault();
      const threadIds = containedThreadIds(target);
      const activeIndex = threadIds.indexOf(activeThreadId ?? "");
      callbacksRef.current.onHighlightClick(
        threadIds[(activeIndex + 1) % threadIds.length]!,
      );
    },
    [activeThreadId],
  );

  const onPointerOver = React.useCallback((event: React.PointerEvent) => {
    const article = articleRef.current!;
    const highlight = (event.target as HTMLElement).closest<HTMLElement>(
      ".emr-highlight",
    );
    const threadId = highlight?.dataset.threadId;
    syncHoveredHighlights(
      article,
      threadId && threadId !== DRAFT_THREAD_ID ? threadId : null,
    );
  }, []);

  const onPointerLeave = React.useCallback(() => {
    syncHoveredHighlights(articleRef.current!, null);
  }, []);

  // -------------------------------------------------------------------------
  // Selection capture: on mouseup, show the floating bubble above a non-empty
  // selection inside the article. Read-only surfaces still get the bubble
  // when the selection can be linked to (its only action is then the link).
  // -------------------------------------------------------------------------
  const onMouseUp = React.useCallback(() => {
    if (readOnly && !hasSelectionLinks) return;
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
      /* v8 ignore next -- captureAnchorFromSelection just read this same live selection synchronously and returned an anchor, so it still has a range */
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
      const block = readOnly
        ? null
        : (callbacksRef.current.commentBlocker?.(anchor) ?? null);
      const link =
        hasSelectionLinks && !block
          ? selectionLinkTarget(article, range)
          : null;
      if (readOnly && !link) {
        setBubble(null);
        return;
      }
      // Approx bubble width (button label + chrome). Used to clamp horizontal.
      const bubbleWidth = selectionBubbleWidth(block, readOnly, link);
      setBubble({
        anchor,
        block,
        link,
        ...selectionBubblePosition(rect, wrapRect, bubbleWidth),
      });
    });
  }, [readOnly, hasSelectionLinks]);

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
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onMouseUp={onMouseUp}
        onPointerLeave={onPointerLeave}
        onPointerOver={onPointerOver}
      />
      {bubble ? (
        <ArticleSelectionBubble
          key={`${bubble.top}:${bubble.left}:${bubble.anchor.exact}`}
          bubble={bubble}
          readOnly={readOnly}
          onCopySelectionLink={onCopySelectionLink}
          onSelection={(a) => callbacksRef.current.onSelection(a)}
          onDismiss={() => setBubble(null)}
        />
      ) : null}
      <GeneratedSourceModal
        kind={generatedSource?.kind}
        source={generatedSource?.source ?? null}
        originalSource={generatedSource?.original ?? null}
        onClose={() => setGeneratedSource(null)}
      />
      {hasHeadingLinks ? (
        <span className="emr-sr-only" role="status" aria-live="polite">
          {linkAnnouncement}
        </span>
      ) : null}
    </div>
  );
}
