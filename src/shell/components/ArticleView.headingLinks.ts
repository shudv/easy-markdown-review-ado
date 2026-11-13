// The "Copy link to section" button `ArticleView` appends to each heading.

import { t } from "../../i18n";

export const HEADING_LINK_CLASS = "emr-heading-link";

export function createHeadingLinkButton(doc: Document, headingId: string): HTMLElement {
    const button = doc.createElement("button");
    const label = t("document.headingLink.copyLink");
    button.type = "button";
    button.className = HEADING_LINK_CLASS;
    button.dataset.headingId = headingId;
    button.setAttribute("aria-label", label);
    button.title = label;

    return button;
}

/** Reflect a copy outcome on the heading link button, then reset it. */
export function showHeadingLinkResult(button: HTMLElement, ok: boolean): void {
    const label = ok ? t("common.linkCopied") : t("common.copyLinkFailed");
    button.classList.toggle("is-copied", ok);
    button.classList.toggle("is-failed", !ok);
    button.setAttribute("aria-label", label);
    button.title = label;
    window.setTimeout(
        () => {
            button.classList.remove("is-copied", "is-failed");
            const resetLabel = t("document.headingLink.copyLink");
            button.setAttribute("aria-label", resetLabel);
            button.title = resetLabel;
        },
        ok ? 1200 : 2400,
    );
}
