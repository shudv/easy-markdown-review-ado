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
import { hydrateMath } from "../../markdown/mathHydrate";
import {
  hydrateDocumentImages,
  type RepositoryImageResolver,
} from "../../markdown/documentImages";
import {
  hydrateMentionLinks,
  MentionLinkContext,
} from "../../comments/mentionLinks";
import { SelectionBubble } from "./SelectionBubble";
import { buildTextFragment, serializeTextFragment } from "../textFragment";
import { GeneratedSourceModal } from "./GeneratedSourceModal";
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

/** Why a selection can't be commented on, and what to do instead. */
export interface CommentBlock {
  message: string;
  actionLabel: string;
  onAction: () => void;
}

/** What "Copy link to selection" links to. */
export interface SelectionLinkTarget {
  /** Serialized text fragment (see `serializeTextFragment`). */
  text: string;
  /** Id of the heading whose section holds the selection, if any. */
  anchor?: string;
}

/** The link target for `range`, or null when it holds no live text. */
function selectionLinkTarget(
  article: HTMLElement,
  range: Range,
): SelectionLinkTarget | null {
  const fragment = buildTextFragment(article, range);
  /* v8 ignore next -- only a selection made entirely of reference content (a diff "Before" panel) has no linkable text */
  if (!fragment) return null;
  const start =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const heading = start
    ?.closest(".emr-section")
    ?.querySelector<HTMLElement>(":scope > :is(h1, h2, h3, h4, h5, h6)[id]");
  return {
    text: serializeTextFragment(fragment),
    ...(heading ? { anchor: heading.id } : {}),
  };
}

const DRAFT_THREAD_ID = "__draft__";

const HEADING_LINK_CLASS = "emr-heading-link";
const HEADING_LINK_LABEL = "Copy link to section";

function createHeadingLinkButton(
  doc: Document,
  headingId: string,
): HTMLElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = HEADING_LINK_CLASS;
  button.dataset.headingId = headingId;
  button.setAttribute("aria-label", HEADING_LINK_LABEL);
  button.title = HEADING_LINK_LABEL;
  return button;
}

/** Reflect a copy outcome on the heading link button, then reset it. */
function showHeadingLinkResult(button: HTMLElement, ok: boolean): void {
  const label = ok ? "Link copied" : "Couldn't copy link";
  button.classList.toggle("is-copied", ok);
  button.classList.toggle("is-failed", !ok);
  button.setAttribute("aria-label", label);
  button.title = label;
  window.setTimeout(
    () => {
      button.classList.remove("is-copied", "is-failed");
      button.setAttribute("aria-label", HEADING_LINK_LABEL);
      button.title = HEADING_LINK_LABEL;
    },
    ok ? 1200 : 2400,
  );
}

function syncActiveHighlights(
  article: HTMLElement,
  activeThreadId: string | null,
  land: boolean,
): void {
  const highlights = Array.from(
    article.querySelectorAll<HTMLElement>(".emr-highlight"),
  );
  highlights.forEach((highlight) => {
    const threadId = highlight.dataset.threadId;
    highlight.classList.toggle(
      "is-active",
      threadId === DRAFT_THREAD_ID || threadId === activeThreadId,
    );
    highlight.classList.remove("is-landing");
  });

  if (!land || activeThreadId === null) return;
  const activeHighlights = highlights.filter(
    (highlight) => highlight.dataset.threadId === activeThreadId,
  );
  if (activeHighlights.length === 0) return;
  void article.offsetWidth;
  activeHighlights.forEach((highlight) =>
    highlight.classList.add("is-landing"),
  );
}

function syncHoveredHighlights(
  article: HTMLElement,
  hoveredThreadId: string | null,
): void {
  article
    .querySelectorAll<HTMLElement>(".emr-highlight")
    .forEach((highlight) =>
      highlight.classList.toggle(
        "is-hover",
        highlight.dataset.threadId === hoveredThreadId,
      ),
    );
}

function containedThreadIds(root: HTMLElement): string[] {
  const highlights = Array.from(
    root.querySelectorAll<HTMLElement>(
      `.emr-highlight:not([data-thread-id="${DRAFT_THREAD_ID}"])`,
    ),
  ).reverse();
  highlights.push(root);
  return [
    ...new Set(highlights.map((highlight) => highlight.dataset.threadId!)),
  ];
}

function addHighlightKeyboardTargets(article: HTMLElement): void {
  const highlights = Array.from(
    article.querySelectorAll<HTMLElement>(".emr-highlight"),
  ).filter((highlight) => highlight.dataset.threadId !== DRAFT_THREAD_ID);
  const roots = highlights.filter(
    (highlight) =>
      !highlight.parentElement?.closest(
        `.emr-highlight:not([data-thread-id="${DRAFT_THREAD_ID}"])`,
      ),
  );
  const represented = new Set<string>();
  roots.forEach((root) => {
    const threadIds = containedThreadIds(root);
    if (
      threadIds.length === 0 ||
      threadIds.every((id) => represented.has(id))
    ) {
      return;
    }
    threadIds.forEach((id) => represented.add(id));
    const anchorText = root.innerText.replace(/\s+/g, " ").trim();
    root.tabIndex = 0;
    root.setAttribute("role", "button");
    let label = "Open comment thread";
    if (threadIds.length > 1) {
      label = `Open ${threadIds.length} overlapping comment threads`;
    }
    root.setAttribute("aria-label", `${label}: ${anchorText}`);
  });
}

/** Generated block whose Source action was clicked (see `GeneratedSourceModal`). */
interface GeneratedSourceView {
  kind: "mermaid" | "math";
  source: string;
  original: string | null;
}

// ---------------------------------------------------------------------------
// Article click delegation. `ArticleView`'s single click listener tries each
// target in order; a handler returns true when it consumed the click.
// ---------------------------------------------------------------------------

/**
 * Relative in-repo doc link (or in-page #anchor) — let the host resolve +
 * navigate instead of the iframe following a dead relative URL. The host
 * returns false for external links (https/mailto/mention…), which then fall
 * through to the browser's default handling.
 */
function handleDocLinkClick(
  e: React.MouseEvent,
  target: HTMLElement,
  onDocLink: ((href: string) => boolean) | undefined,
): boolean {
  if (!onDocLink) return false;
  const link = target.closest<HTMLElement>("a[href]");
  if (link && onDocLink(link.getAttribute("href")!)) {
    e.preventDefault();
    return true;
  }
  return false;
}

function decodeGeneratedSource(enc: string): string {
  try {
    return decodeURIComponent(enc);
  } catch {
    /* v8 ignore next -- decode only throws on malformed input */
    return enc;
  }
}

/** 0) Generated-content Source affordance — open diagram/equation source. */
function handleGeneratedSourceClick(
  e: React.MouseEvent,
  target: HTMLElement,
  setGeneratedSource: (view: GeneratedSourceView) => void,
): boolean {
  const sourceBtn = target.closest<HTMLElement>(
    GENERATED_SOURCE_BUTTON_SELECTOR,
  );
  if (!sourceBtn) return false;
  e.preventDefault();
  const spec = GENERATED_SOURCE_KINDS.find((candidate) =>
    sourceBtn.classList.contains(candidate.buttonClass),
  )!;
  const block = sourceBtn.closest<HTMLElement>(spec.hostSelector);
  const enc = block?.getAttribute(spec.sourceAttribute);
  const original = block?.dataset.diffOriginal ?? null;
  /* v8 ignore next -- source buttons are added only to encoded blocks */
  if (enc) {
    const source = decodeGeneratedSource(enc);
    setGeneratedSource({ kind: spec.kind, source, original });
    track(
      spec.kind === "math"
        ? events.mathSourceViewed({ changed: original !== null })
        : events.mermaidSourceViewed({ changed: original !== null }),
    );
  }
  return true;
}

/** 1) Heading link — copy a shareable link to this section. */
function handleHeadingLinkClick(
  e: React.MouseEvent,
  target: HTMLElement,
  onCopyHeadingLink: ((headingId: string) => Promise<boolean>) | undefined,
  setLinkAnnouncement: (text: string) => void,
): boolean {
  const headingLink = target.closest<HTMLElement>(`.${HEADING_LINK_CLASS}`);
  if (!headingLink) return false;
  e.preventDefault();
  const headingId = headingLink.dataset.headingId!;
  /* v8 ignore next -- buttons are only rendered when the callback exists */
  if (!onCopyHeadingLink) return true;
  void onCopyHeadingLink(headingId).then((ok) => {
    showHeadingLinkResult(headingLink, ok);
    setLinkAnnouncement(ok ? "Link copied" : "Couldn't copy link");
  });
  return true;
}

/**
 * 2) Section toggle. Only the dedicated chevron button folds content; heading
 * text remains ordinary selectable/commentable document text.
 */
function handleSectionToggleClick(
  target: HTMLElement,
  storageKey: string,
  wrapRef: React.RefObject<HTMLDivElement | null>,
): boolean {
  const sectionToggle = target.closest<HTMLButtonElement>(
    ".emr-section-toggle",
  );
  if (!sectionToggle) return false;
  const section = sectionToggle.closest<HTMLElement>(".emr-section");
  /* v8 ignore next -- toggle buttons are only hydrated inside sections */
  if (!section) return true;
  /* v8 ignore next -- hydrated sections always carry a source-derived id */
  const sid = section.dataset.sectionId ?? "";
  const wasCollapsed = section.getAttribute("data-collapsed") === "true";
  if (wasCollapsed) section.removeAttribute("data-collapsed");
  else section.setAttribute("data-collapsed", "true");
  sectionToggle.setAttribute(
    "aria-label",
    wasCollapsed ? "Collapse section" : "Expand section",
  );
  sectionToggle.setAttribute("aria-expanded", wasCollapsed ? "true" : "false");
  sectionToggle.title = sectionToggle.getAttribute("aria-label")!;
  /* v8 ignore next -- sid is always non-empty; guard remains defensive */
  if (sid) persistSectionState(storageKey, sid, !wasCollapsed);
  wrapRef.current?.dispatchEvent(
    new CustomEvent("emr-sections-changed", { bubbles: false }),
  );
  return true;
}

/**
 * 3) Highlight click — the thread to open. Overlapping anchors are nested, so
 * collect every thread under the click and cycle on repeated clicks; exact
 * overlaps remain reachable without stacking visual layers. Null when the
 * click hit no comment highlight.
 */
function nextClickedThreadId(
  target: HTMLElement,
  article: HTMLElement | null,
  activeThreadId: string | null,
): string | null {
  const threadIds: string[] = [];
  let highlight = target.closest<HTMLElement>(".emr-highlight");
  while (highlight && article?.contains(highlight)) {
    const threadId = highlight.dataset.threadId;
    if (
      threadId &&
      threadId !== DRAFT_THREAD_ID &&
      !threadIds.includes(threadId)
    ) {
      threadIds.push(threadId);
    }
    highlight =
      highlight.parentElement?.closest<HTMLElement>(".emr-highlight") ?? null;
  }
  if (threadIds.length === 0) return null;
  const activeIndex = threadIds.indexOf(activeThreadId ?? "");
  return threadIds[(activeIndex + 1) % threadIds.length]!;
}

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
  const [bubble, setBubble] = React.useState<{
    top: number;
    left: number;
    anchor: TextQuoteAnchor;
    /** Set when a comment can't be attached to this selection. */
    block: CommentBlock | null;
    /** Set when the selection can be linked to. */
    link: SelectionLinkTarget | null;
  } | null>(null);
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
        .map(
          (t) =>
            `${t.id}|${t.status}|${t.anchor.exact}|${t.anchor.prefix}|${t.anchor.suffix}|${t.anchor.line ?? ""}|${t.anchor.implicit === true}`,
        )
        .join("\n"),
    [threads],
  );
  const draftKey = draftAnchor
    ? `${draftAnchor.exact}|${draftAnchor.prefix}|${draftAnchor.suffix}|${draftAnchor.line ?? ""}|${draftAnchor.implicit === true}`
    : "";
  const previousActiveThreadIdRef = React.useRef<string | null>(null);

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
    const focusedThreadId = article.contains(
      article.ownerDocument.activeElement,
    )
      ? (
          article.ownerDocument.activeElement as HTMLElement
        ).closest<HTMLElement>('.emr-highlight[role="button"]')?.dataset
          .threadId
      : undefined;
    // A keyboard user on a heading link button keeps their place when a
    // thread poll / diff / image load re-wraps the article.
    const focusedHeadingLinkId = article.contains(
      article.ownerDocument.activeElement,
    )
      ? (
          article.ownerDocument.activeElement as HTMLElement
        ).closest<HTMLElement>(`.${HEADING_LINK_CLASS}`)?.dataset.headingId
      : undefined;

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
      const heading = s.querySelector<HTMLElement>(
        ":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6",
      );
      // A shareable link to the section, appended after the heading text so it
      // sits where ADO's native preview shows its anchor glyph. Icon-only (no
      // text node), so it never leaks into anchoring, outline labels, or the
      // heading's accessible name below.
      if (heading?.id && hasHeadingLinks) {
        heading.setAttribute("aria-label", heading.textContent.trim());
        heading.append(
          createHeadingLinkButton(article.ownerDocument, heading.id),
        );
      }
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
      /* v8 ignore next -- rendered sections always begin with their heading */
      if (!heading) return;
      // The icon button lives inside the heading for stable gutter geometry;
      // pin the heading's accessible name to its document text so the button's
      // own "Collapse section" label is not folded into the heading name.
      heading.setAttribute("aria-label", heading.textContent.trim());
      const collapsed = s.getAttribute("data-collapsed") === "true";
      const toggle = article.ownerDocument.createElement("button");
      toggle.type = "button";
      toggle.className = "emr-section-toggle";
      toggle.setAttribute(
        "aria-label",
        collapsed ? "Expand section" : "Collapse section",
      );
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      toggle.title = toggle.getAttribute("aria-label")!;
      heading.prepend(toggle);
    });

    // Wrap each anchor with a highlight span; defer y measurement until all
    // wraps are done so section toggles can re-measure without re-wrapping.
    const wrapOne = (
      threadId: string,
      anchor: TextQuoteAnchor,
      classes: string,
    ): boolean => {
      const range = resolveAnchor(article, anchor);
      if (anchor.implicit) {
        const marker = document.createElement("span");
        marker.className = "emr-implicit-anchor";
        marker.dataset.threadId = threadId;
        marker.setAttribute("aria-hidden", "true");
        if (range) {
          const insertion = range.cloneRange();
          insertion.collapse(true);
          insertion.insertNode(marker);
        } else {
          article.prepend(marker);
        }
        return true;
      }
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

    addHighlightKeyboardTargets(article);

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

    // Rewraps create fresh spans, so restore selection without replaying the
    // transient landing cue. The active-thread effect owns that animation.
    syncActiveHighlights(article, activeThreadId, false);
    if (focusedThreadId) {
      article
        .querySelector<HTMLElement>(
          `.emr-highlight[role="button"][data-thread-id="${CSS.escape(focusedThreadId)}"]`,
        )
        ?.focus();
    }
    if (focusedHeadingLinkId) {
      article
        .querySelector<HTMLElement>(
          `.${HEADING_LINK_CLASS}[data-heading-id="${CSS.escape(focusedHeadingLinkId)}"]`,
        )
        ?.focus({ preventScroll: true });
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
      const highlights = article!.querySelectorAll<HTMLElement>(
        ".emr-highlight, .emr-implicit-anchor",
      );
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
      /* v8 ignore next -- the observer can fire after unmount clears the ref */
      if (!article) return;
      void hydrateMermaid(article, readerFontFamily).then(() => {
        /* v8 ignore next -- unmounted between hydrate start and resolve */
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
      const block = readOnly
        ? null
        : (callbacksRef.current.commentBlocker?.(anchor) ?? null);
      const link =
        hasSelectionLinks && !block
          ? selectionLinkTarget(article, range)
          : null;
      /* v8 ignore next 4 -- only a selection made entirely of reference content (a diff "Before" panel) has no linkable text; read-only stories don't render those panels */
      if (readOnly && !link) {
        setBubble(null);
        return;
      }
      // Approx bubble width (button label + chrome). Used to clamp horizontal.
      // The explained (blocked) variant carries a sentence and an action.
      const BUBBLE_W = block ? 320 : readOnly ? 104 : link ? 170 : 132;
      const desiredTop = rect.top - wrapRect.top - 36;
      const desiredLeft =
        rect.left + rect.width / 2 - wrapRect.left - BUBBLE_W / 2;
      setBubble({
        anchor,
        block,
        link,
        // Don't render above the article. If selection is at the very top,
        // tuck the bubble just below it instead of off-screen.
        /* v8 ignore next -- top-of-article clamp; headless getBoundingClientRect yields zeros */
        top: desiredTop < 4 ? rect.bottom - wrapRect.top + 8 : desiredTop,
        // Clamp horizontally so the bubble always fully fits inside wrap.
        left: Math.max(4, Math.min(desiredLeft, wrapRect.width - BUBBLE_W - 4)),
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
        <SelectionBubble
          key={`${bubble.top}:${bubble.left}:${bubble.anchor.exact}`}
          top={bubble.top}
          left={bubble.left}
          block={
            bubble.block
              ? {
                  ...bubble.block,
                  onAction: () => {
                    const action = bubble.block!.onAction;
                    setBubble(null);
                    window.getSelection()?.removeAllRanges();
                    action();
                  },
                }
              : null
          }
          onAddComment={
            readOnly
              ? undefined
              : () => {
                  const a = bubble.anchor;
                  setBubble(null);
                  // Collapse selection so the highlight is visible.
                  window.getSelection()?.removeAllRanges();
                  callbacksRef.current.onSelection(a);
                }
          }
          onCopyLink={
            bubble.link && onCopySelectionLink
              ? () => onCopySelectionLink(bubble.link!)
              : undefined
          }
          onCopyLinkSettled={() => setBubble(null)}
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

/**
 * Both generated block kinds share one Source affordance and one callout, so
 * the per-kind selectors/labels live here rather than in duplicated branches.
 */
const GENERATED_SOURCE_KINDS = [
  {
    kind: "mermaid",
    hostSelector: ".emr-mermaid",
    hydratedSelector: ".emr-mermaid[data-mermaid-src]",
    buttonClass: "emr-mermaid-source-btn",
    sourceAttribute: "data-mermaid-src",
    errorAttribute: "data-mermaid-error",
    buttonTitle: "View diagram source",
  },
  {
    kind: "math",
    hostSelector: ".emr-math",
    hydratedSelector: '.emr-math[data-math-src][data-hydrated="true"]',
    buttonClass: "emr-math-source-btn",
    sourceAttribute: "data-math-src",
    errorAttribute: "data-math-error",
    buttonTitle: "View equation source",
  },
] as const;

const GENERATED_SOURCE_BUTTON_SELECTOR = GENERATED_SOURCE_KINDS.map(
  (spec) => `.${spec.buttonClass}`,
).join(", ");

/**
 * Inject the "</> Source" affordance into every hydrated diagram/equation.
 * Runs after hydration so each block still carries its encoded source
 * attribute, which the callout reads back without extra state plumbing.
 */
function addGeneratedSourceButtons(root: HTMLElement): void {
  for (const spec of GENERATED_SOURCE_KINDS) {
    root
      .querySelectorAll<HTMLElement>(spec.hydratedSelector)
      .forEach((block) => {
        /* v8 ignore next -- hydration rebuilds block markup before each pass */
        if (block.querySelector(`:scope > .${spec.buttonClass}`)) return;
        if (block.getAttribute(spec.errorAttribute)) return;
        const button = document.createElement("button");
        button.type = "button";
        button.className = spec.buttonClass;
        button.title = spec.buttonTitle;
        button.textContent = "</> Source";
        block.appendChild(button);
      });
  }
}
