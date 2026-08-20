// Boot-failure UI renderer (shared by the iframe entry points).
//
// When an entry point fails to initialise, we surface the error INSIDE the
// iframe so it can be diagnosed without dev-tools. The detail string can carry
// arbitrary text (an Error message / stack, or a stringified unknown), so it
// must never be interpolated into `innerHTML`. This helper builds the DOM
// with `document.createElement` + `textContent`, which removes the escaping
// invariant entirely (there is no HTML string to escape), rather than relying
// on a hand-rolled `escapeHtml` that a single dropped character could weaken.

/** Heading shown above the error detail. */
export const BOOT_ERROR_HEADING = "Markdown Review failed to load";

/**
 * Replace the contents of `root` with a readable boot-error panel whose detail
 * text is set via `textContent` (never HTML). Safe against hostile error text:
 * markup in `detail` renders as literal characters, not nodes.
 */
export function renderBootErrorInto(root: HTMLElement, detail: string): void {
  // Clear any partially-rendered content.
  root.replaceChildren();

  const container = document.createElement("div");
  container.style.padding = "24px";
  container.style.fontFamily = "'Segoe UI', system-ui, sans-serif";
  container.style.color = "#cd3030";

  const heading = document.createElement("h2");
  heading.style.marginTop = "0";
  heading.textContent = BOOT_ERROR_HEADING;

  const pre = document.createElement("pre");
  pre.style.whiteSpace = "pre-wrap";
  pre.style.background = "#f7f7f7";
  pre.style.padding = "12px";
  pre.style.borderRadius = "4px";
  pre.style.color = "#333";
  // The one line that matters: textContent, so `detail` can never inject nodes.
  pre.textContent = detail;

  container.append(heading, pre);
  root.append(container);
}

/** Reduce an unknown thrown value to the detail string shown in the panel. */
export function bootErrorDetail(err: unknown): string {
  return err instanceof Error ? err.stack || err.message : String(err);
}
