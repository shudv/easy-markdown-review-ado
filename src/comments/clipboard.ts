// Clipboard write with a host-iframe fallback.
//
// Azure DevOps serves the extension inside a sandboxed, cross-origin iframe
// whose `Permissions-Policy` does NOT delegate `clipboard-write`. The async
// Clipboard API (`navigator.clipboard.writeText`) therefore rejects with
// `NotAllowedError` in the real host — not just under the dev cert. The legacy
// `document.execCommand("copy")` path is not gated by that policy and still
// works inside the iframe, so we use it as a fallback before giving up.
//
// `copyText` never rejects: it resolves to `true` on a confirmed copy and
// `false` when every strategy fails, so callers can branch on the result
// without risking an unhandled promise rejection.

/**
 * Copy `text` to the clipboard, preferring the async Clipboard API and falling
 * back to the legacy `execCommand` path when the host iframe blocks it.
 *
 * @returns `true` if a copy was confirmed, `false` otherwise.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Blocked by the host iframe's Permissions-Policy — fall through to the
      // legacy command, which the sandbox still permits.
    }
  }
  return legacyCopyText(text);
}

/**
 * Copy via a transient, off-screen `<textarea>` + `document.execCommand`. This
 * is deprecated but remains the only clipboard write that ADO's sandboxed
 * extension iframe allows.
 */
function legacyCopyText(text: string): boolean {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    // Keep it out of the layout/viewport so it never flashes or scrolls.
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}
