// Manages the GitHub Markdown stylesheet at runtime.
//
// The "universal" `github-markdown.css` gates its theme variables behind
// `@media (prefers-color-scheme: …)` blocks, which means the `data-theme`
// attribute it documents is *only* honoured when the OS preference happens
// to match. To get a deterministic light/dark switch we side-step that and
// load the two unconditional variants (`-light.css` / `-dark.css`) as raw
// strings and swap the active one through a managed `<style>` tag.
//
// Webpack's `?raw` query is wired to `asset/source` in webpack.config.cjs
// so each `import … from "…?raw"` resolves to the file's text contents.

import lightCss from "github-markdown-css/github-markdown-light.css?raw";
import darkCss from "github-markdown-css/github-markdown-dark.css?raw";

let styleEl: HTMLStyleElement | null = null;
let currentDark: boolean | null = null;

/**
 * Apply the dark or light GitHub Markdown stylesheet. Idempotent — calling
 * with the same value twice is a no-op. Safe in non-DOM environments
 * (returns silently).
 */
export function setMarkdownDark(isDark: boolean): void {
  if (typeof document === "undefined") return;
  if (currentDark === isDark && styleEl && styleEl.isConnected) return;

  if (!styleEl || !styleEl.isConnected) {
    styleEl = document.createElement("style");
    styleEl.setAttribute("data-emr-markdown-theme", "");
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = isDark ? darkCss : lightCss;
  currentDark = isDark;
}
