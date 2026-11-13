// Boot-failure UI renderer (shared by the iframe entry points).
//
// When an entry point fails to initialise, we surface the error INSIDE the
// iframe so it can be diagnosed without dev-tools. The detail string can carry
// arbitrary text (an Error message / stack, or a stringified unknown), so it
// must never be interpolated into `innerHTML`. This helper builds the DOM
// with `document.createElement` + `textContent`, which removes the escaping
// invariant entirely (there is no HTML string to escape), rather than relying
// on a hand-rolled `escapeHtml` that a single dropped character could weaken.

import { t } from "../i18n";

/** Heading shown above the error detail. */
export function bootErrorHeading(): string {
    return t("hub.bootError.heading");
}

/**
 * Replace the contents of `root` with a readable boot-error panel whose detail
 * text is set via `textContent` (never HTML). Safe against hostile error text:
 * markup in `detail` renders as literal characters, not nodes.
 */
export function renderBootErrorInto(root: HTMLElement, detail: string): void {
    // Clear any partially-rendered content.
    root.replaceChildren();

    const container = document.createElement("div");
    // Stryker disable StringLiteral: inline layout and colour only — the panel's heading and detail text read the same without them
    container.style.padding = "24px";
    container.style.fontFamily = "'Segoe UI', system-ui, sans-serif";
    container.style.color = "#cd3030";
    // Stryker restore StringLiteral

    const heading = document.createElement("h2");
    // Stryker disable next-line StringLiteral: inline layout only — the heading reads the same without it
    heading.style.marginTop = "0";
    heading.textContent = bootErrorHeading();

    const pre = document.createElement("pre");
    // Stryker disable StringLiteral: inline layout and colour only — the detail text reads the same without them
    pre.style.whiteSpace = "pre-wrap";
    pre.style.background = "#f7f7f7";
    pre.style.padding = "12px";
    pre.style.borderRadius = "4px";
    pre.style.color = "#333";
    // Stryker restore StringLiteral
    // The one line that matters: textContent, so `detail` can never inject nodes.
    pre.textContent = detail;

    container.append(heading, pre);
    root.append(container);
}

/** Reduce an unknown thrown value to the detail string shown in the panel. */
export function bootErrorDetail(err: unknown): string {
    if (!(err instanceof Error)) return String(err);

    return err.stack !== undefined && err.stack !== "" ? err.stack : err.message;
}
