// ---------------------------------------------------------------------------
// Article click delegation. `ArticleView`'s single click listener tries each
// target in order; a handler returns true when it consumed the click.
// ---------------------------------------------------------------------------

import type * as React from "react";
import { persistSectionState } from "./navStorage";
import { events, track } from "../../telemetry";
import {
  HEADING_LINK_CLASS,
  showHeadingLinkResult,
} from "./ArticleView.headingLinks";
import { DRAFT_THREAD_ID } from "./ArticleView.highlights";
import {
  decodeGeneratedSource,
  GENERATED_SOURCE_BUTTON_SELECTOR,
  GENERATED_SOURCE_KINDS,
  type GeneratedSourceView,
} from "./ArticleView.generatedSource";

/**
 * Relative in-repo doc link (or in-page #anchor) — let the host resolve +
 * navigate instead of the iframe following a dead relative URL. The host
 * returns false for external links (https/mailto/mention…), which then fall
 * through to the browser's default handling.
 */
export function handleDocLinkClick(
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

/** 0) Generated-content Source affordance — open diagram/equation source. */
export function handleGeneratedSourceClick(
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
export function handleHeadingLinkClick(
  e: React.MouseEvent,
  target: HTMLElement,
  onCopyHeadingLink: ((headingId: string) => Promise<boolean>) | undefined,
  setLinkAnnouncement: (text: string) => void,
): boolean {
  const headingLink = target.closest<HTMLElement>(`.${HEADING_LINK_CLASS}`);
  if (!headingLink) return false;
  e.preventDefault();
  const headingId = headingLink.dataset.headingId!;
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
export function handleSectionToggleClick(
  target: HTMLElement,
  storageKey: string,
  wrapRef: React.RefObject<HTMLDivElement | null>,
): boolean {
  const sectionToggle = target.closest<HTMLButtonElement>(
    ".emr-section-toggle",
  );
  if (!sectionToggle) return false;
  const section = sectionToggle.closest<HTMLElement>(".emr-section");
  if (!section) return true;
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
export function nextClickedThreadId(
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
