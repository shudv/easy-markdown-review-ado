// The "Open in Markdown Review ↗" link on threads started here.
//
// Comments posted here appear in Azure DevOps' own PR comment UI too, where
// nothing told a reader they came from — or could be read in — Markdown
// Review. Growth had stalled at a few new projects a week, so each thread
// started here ends with one small link back to the thread in the document.
// The link is for ADO's UI only: it's stripped wherever the app reads a comment
// (so it never shows, is never searched or quoted here), and kept when the
// comment is edited here.
//
// The link sits between two HTML-comment markers, which ADO keeps in the
// stored comment but doesn't show. Finding the link relies only on those
// markers, so what's between them (`footerContent`) can be restyled freely:
// comments written with an older design are still recognised.

import { withDeepLinkTarget } from "./deepLink";

const START = "<!-- emr:back-link -->";
const END = "<!-- /emr:back-link -->";

/**
 * Longest marked block (markers included) treated as the back link. A longer
 * one is shown as written: the markers are plain text anyone can type, and
 * this keeps them from hiding more than a link's worth of a comment here.
 * `withBackLink` never writes a longer one.
 */
const MAX_FOOTER_CHARS = 1000;

/**
 * What ADO's comment UI shows between the markers: a small tinted chip.
 * ADO keeps these inline styles but strips `border-radius`; its own
 * stylesheet rounds `<code>` (2px), so the label is a `<code>` in the
 * comment's font. 1px more padding below than above centres Segoe UI's
 * label; the label takes ADO's link colour, so it suits light and dark.
 */
function footerContent(url: string): string {
    // `URL` percent-encodes quotes; this keeps the attribute closed regardless.
    const href = url.replace(/"/g, "%22");

    const chip =
        "font-family:inherit;font-size:12px;padding:1px 8px 3px;" +
        "background:rgba(0,120,212,0.12);color:inherit;border:1px solid rgba(0,120,212,0.3)";

    return `<a href="${href}" style="text-decoration:none"><code style="${chip}">Open in Markdown Review ↗</code></a>`;
}

/**
 * `body` with the back link appended, or unchanged when there's no URL — or
 * one so long the app wouldn't recognise the block to hide it.
 */
export function withBackLink(body: string, url: string | undefined): string {
    if (url === undefined || url === "") return body;
    const block = `${START}\n${footerContent(url)}\n${END}`;
    if (block.length > MAX_FOOTER_CHARS) return body;

    return `${body.trimEnd()}\n\n${block}`;
}

/**
 * Split a comment's stored content into what the author wrote and the back
 * link. The link is the last marked block, and only when it ends the comment:
 * if anything was written after it (say, in ADO's editor), the comment is
 * shown whole rather than risk hiding those words.
 */
export function splitBackLink(content: string): { body: string; footer: string } {
    const none = { body: content, footer: "" };
    const end = content.lastIndexOf(END);
    if (end < 0 || content.slice(end + END.length).trim() !== "") return none;
    const start = content.lastIndexOf(START, end);
    if (start < 0 || end + END.length - start > MAX_FOOTER_CHARS) return none;
    const body = content.slice(0, start).trimEnd();

    return { body, footer: content.slice(body.length) };
}

/** A comment's content as the app shows it: without the back link. */
export function stripBackLink(content: string): string {
    return splitBackLink(content).body;
}

// ADO thread ids are numbers, so a `k-` key can never be mistaken for one.
const LINK_KEY_PREFIX = "k-";

/**
 * A fresh key naming a thread before ADO has assigned its id. Saved on the
 * thread and used in its back link as `?comment=<key>`, which opens the
 * document with that thread selected (see `threadIdForLink`).
 */
export function newLinkKey(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(6));

    return `${LINK_KEY_PREFIX}${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Whether a `?comment=` value is a back link's key rather than a thread id. */
export function isLinkKey(linked: string): boolean {
    return linked.startsWith(LINK_KEY_PREFIX);
}

/**
 * A back link's URL: the document's URL (`docUrl`, from the surface the
 * thread was started on) with the thread's link key as its comment target.
 * `undefined` when there's no document URL.
 */
export function backLinkUrl(docUrl: string | undefined, linkKey: string): string | undefined {
    return docUrl === undefined
        ? undefined
        : withDeepLinkTarget(docUrl, { kind: "comment", threadId: linkKey });
}

/**
 * The id of the thread a `?comment=` link names: a thread id as is, or for a
 * back link's key, the thread carrying that key (unchanged when none does).
 */
export function threadIdForLink(
    linked: string,
    threads: Readonly<Record<string, { linkKey?: string }>>,
): string {
    if (!isLinkKey(linked)) return linked;

    return Object.keys(threads).find((id) => threads[id]!.linkKey === linked) ?? linked;
}
