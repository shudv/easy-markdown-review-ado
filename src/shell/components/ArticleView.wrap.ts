// Phases of `ArticleView`'s wrap pass (its main layout effect): section
// hydration, anchor wrapping, y measurement, and rewrap focus restoration.

import { t } from "../../i18n";
import type { CommentThread, DiffRange, TextQuoteAnchor } from "../../types";
import { isResolvedLike } from "../../types";
import { resolveAnchor } from "../../comments/anchor";
import { wrapRangeWithHighlight } from "../../comments/highlight";
import { readSectionState } from "./navStorage";
import { createHeadingLinkButton, HEADING_LINK_CLASS } from "./ArticleView.headingLinks";
import { DRAFT_THREAD_ID } from "./ArticleView.highlights";

/** Signature of an anchor's identity, for the wrap effect's dependency keys. */
export function anchorSignature(anchor: TextQuoteAnchor): string {
    return `${anchor.exact}|${anchor.prefix}|${anchor.suffix}|${anchor.line ?? ""}|${anchor.implicit === true}`;
}

/** True when diff decorations are on and there are changed ranges to show. */
export function hasVisibleDiff(
    showDiff: boolean,
    diff: readonly DiffRange[] | undefined,
): diff is readonly DiffRange[] {
    return showDiff && !!diff && diff.length > 0;
}

/**
 * `dataset[key]` of the focused element's closest `selector` match, when focus
 * is inside `article` — read before a rewrap so the focus can be restored.
 */
export function focusedDatasetValue(
    article: HTMLElement,
    selector: string,
    key: string,
): string | undefined {
    const active = article.ownerDocument.activeElement;

    return article.contains(active)
        ? (active as HTMLElement).closest<HTMLElement>(selector)?.dataset[key]
        : undefined;
}

/** Re-focus the highlight / heading link that held focus before a rewrap. */
export function restoreRewrapFocus(
    article: HTMLElement,
    focusedThreadId: string | undefined,
    focusedHeadingLinkId: string | undefined,
): void {
    if (focusedThreadId !== undefined && focusedThreadId !== "") {
        article
            .querySelector<HTMLElement>(
                `.emr-highlight[role="button"][data-thread-id="${CSS.escape(focusedThreadId)}"]`,
            )
            ?.focus();
    }

    if (focusedHeadingLinkId !== undefined && focusedHeadingLinkId !== "") {
        article
            .querySelector<HTMLElement>(
                `.${HEADING_LINK_CLASS}[data-heading-id="${CSS.escape(focusedHeadingLinkId)}"]`,
            )
            ?.focus({ preventScroll: true });
    }
}

/**
 * Hydrate one section: its heading link button, persisted collapse state, and
 * collapse toggle.
 */
function hydrateSection(
    article: HTMLElement,
    s: HTMLElement,
    storageKey: string,
    hasHeadingLinks: boolean,
): void {
    const heading = s.querySelector<HTMLElement>(
        ":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6",
    );

    // A shareable link to the section, appended after the heading text so it
    // sits where ADO's native preview shows its anchor glyph. Icon-only (no
    // text node), so it never leaks into anchoring, outline labels, or the
    // heading's accessible name below.
    if (heading != null && heading.id !== "" && hasHeadingLinks) {
        heading.setAttribute("aria-label", heading.textContent.trim());
        heading.append(createHeadingLinkButton(article.ownerDocument, heading.id));
    }

    // The document-title section is never collapsible (it has no chevron),
    // so ignore any persisted state and keep it open.
    if (s.classList.contains("emr-section--doc-title")) {
        s.removeAttribute("data-collapsed");

        return;
    }

    const sid = s.dataset.sectionId;

    if (sid !== undefined && sid !== "" && readSectionState(storageKey, sid)) {
        s.setAttribute("data-collapsed", "true");
    } else {
        s.removeAttribute("data-collapsed");
    }

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
        collapsed ? t("common.expandSection") : t("common.collapseSection"),
    );
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggle.title = toggle.getAttribute("aria-label")!;
    heading.prepend(toggle);
}

export function hydrateSections(
    article: HTMLElement,
    storageKey: string,
    hasHeadingLinks: boolean,
): void {
    const sections = article.querySelectorAll<HTMLElement>(".emr-section");
    sections.forEach((s) => hydrateSection(article, s, storageKey, hasHeadingLinks));
}

/** Wrap one anchor with a highlight span (or implicit marker); false if orphaned. */
function wrapOne(
    article: HTMLElement,
    threadId: string,
    anchor: TextQuoteAnchor,
    classes: string,
): boolean {
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
}

/** Wrap every thread anchor, then the draft anchor. */
export function wrapAnchors(
    article: HTMLElement,
    threads: readonly CommentThread[],
    draftAnchor: TextQuoteAnchor | null,
): { orphaned: string[]; hasDraft: boolean } {
    const orphaned: string[] = [];

    for (const t of threads) {
        const cls = isResolvedLike(t.status) ? "is-resolved" : "";
        const ok = wrapOne(article, t.id, t.anchor, cls);
        if (!ok) orphaned.push(t.id);
    }

    let hasDraft = false;

    if (draftAnchor) {
        hasDraft = wrapOne(article, DRAFT_THREAD_ID, draftAnchor, "is-active");
    }

    return { orphaned, hasDraft };
}

/**
 * Measure y of every wrapped highlight relative to the article-wrap.
 * Highlights in a collapsed section have a zero rect; for those we use
 * the section heading's y so balloons cluster at the section.
 */
export function measureAnchorYs(
    wrap: HTMLElement,
    article: HTMLElement,
): { yByThreadId: Map<string, number>; draftY: number | null } {
    const wrapRect = wrap.getBoundingClientRect();
    const yByThreadId = new Map<string, number>();
    let draftY: number | null = null;

    const seen = new Set<string>();

    const highlights = article.querySelectorAll<HTMLElement>(
        ".emr-highlight, .emr-implicit-anchor",
    );

    highlights.forEach((el) => {
        const tid = el.dataset.threadId;
        if (tid === undefined || tid === "" || seen.has(tid)) return;
        seen.add(tid);
        const rect = el.getBoundingClientRect();
        let y: number;

        if (rect.width === 0 && rect.height === 0) {
            // Hidden inside a collapsed section — fall back to heading y.
            const section = el.closest<HTMLElement>(".emr-section");

            const heading = section?.querySelector<HTMLElement>("h1, h2, h3, h4, h5, h6");

            y = heading ? heading.getBoundingClientRect().top - wrapRect.top : 0;
        } else {
            y = rect.top - wrapRect.top;
        }

        if (tid === DRAFT_THREAD_ID) draftY = y;
        else yByThreadId.set(tid, y);
    });

    return { yByThreadId, draftY };
}
