// The "Copy link to section" button `ArticleView` appends to each heading.

export const HEADING_LINK_CLASS = "emr-heading-link";
const HEADING_LINK_LABEL = "Copy link to section";

export function createHeadingLinkButton(
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
export function showHeadingLinkResult(button: HTMLElement, ok: boolean): void {
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
