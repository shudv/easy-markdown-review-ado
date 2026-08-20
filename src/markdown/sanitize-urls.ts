// URL-scheme sanitization for the rendered Markdown HAST tree.
//
// Raw HTML is parsed through `rehypeSafeHtml`, but neither it nor
// `remark-rehype` validates URLs on `<a href>` / `<img src>`, so markdown like
// `[x](javascript:alert(1))` would become a live dangerous link. This plugin
// closes that hole.
//
// Policy:
//   * `<a href>`  — allow http(s), mailto, tel, ftp, sftp, `mention:` (our
//                   internal scheme), fragment-only, and relative URLs.
//                   Anything else → href removed + `data-emr-blocked-scheme`.
//   * `<img src>` — allow http(s), fragment, relative only. `data:` is
//                   blocked (can carry script via `data:image/svg+xml`);
//                   blocked src is removed and an `alt` is added if missing.
//   * `<a target>`— new-context links always get `rel="noopener noreferrer"`.
//
// Anything not enumerated is left untouched; when in doubt we drop rather
// than rewrite.

import type { Plugin } from "unified";
import type { Root, Element } from "hast";
import { visit } from "unist-util-visit";

/** Schemes we permit on `<a href>`. */
const SAFE_LINK_SCHEMES = new Set([
  "http:",
  "https:",
  "mailto:",
  "tel:",
  "ftp:",
  "sftp:",
  "mention:",
]);

/** Schemes we permit on `<img src>`. */
const SAFE_IMAGE_SCHEMES = new Set(["http:", "https:"]);

/**
 * Classify a URL as safe-for-context or not. Relative, fragment-only, and
 * protocol-relative URLs are always safe — they can't introduce a
 * script-execution scheme on their own.
 */
function classifyUrl(
  raw: string,
  allowed: ReadonlySet<string>,
): { safe: true } | { safe: false; reason: string } {
  const url = raw.trim();
  if (url === "") return { safe: false, reason: "empty" };
  if (
    Array.from(url).some((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    return { safe: false, reason: "control-character" };
  }

  if (url.startsWith("#")) return { safe: true };

  if (url.startsWith("/") || url.startsWith("./") || url.startsWith("../")) {
    return { safe: true };
  }

  // Direct scheme check on the raw string — stricter and simpler than relying
  // on `new URL()` quirks for inputs like `javascript:alert(1)`.
  const schemeMatch = /^([a-z][a-z0-9+\-.]*):/i.exec(url);
  if (!schemeMatch) {
    // No scheme — treat as a relative reference.
    return { safe: true };
  }

  const scheme = schemeMatch[1]!.toLowerCase() + ":";
  if (allowed.has(scheme)) return { safe: true };

  return { safe: false, reason: scheme };
}

/**
 * Scrub unsafe URLs on links/images and force `rel="noopener noreferrer"` on
 * new-context links. Run AFTER any plugin that mutates `href`/`src` and
 * BEFORE `rehype-stringify`.
 */
export const rehypeSanitizeUrls: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "element", (node: Element) => {
      const tag = node.tagName;
      const props = (node.properties ??= {});

      if (tag === "a") {
        const href = props.href;
        if (typeof href === "string") {
          const verdict = classifyUrl(href, SAFE_LINK_SCHEMES);
          if (!verdict.safe) {
            delete props.href;
            props["dataEmrBlockedScheme"] = verdict.reason;
          }
        }
        // New-context links always get safe rel, overriding any weaker value.
        if (typeof props.target === "string" && props.target.length > 0) {
          const required = new Set(["noopener", "noreferrer"]);
          const existing = Array.isArray(props.rel)
            ? (props.rel as unknown[]).map(String)
            : typeof props.rel === "string"
              ? (props.rel as string).split(/\s+/).filter(Boolean)
              : [];
          for (const r of existing) required.add(r);
          props.rel = Array.from(required);
        }
      } else if (tag === "img") {
        const src = props.src;
        if (typeof src === "string") {
          const verdict = classifyUrl(src, SAFE_IMAGE_SCHEMES);
          if (!verdict.safe) {
            delete props.src;
            props["dataEmrBlockedScheme"] = verdict.reason;
            // Preserve accessibility: if there's no alt, advertise that an
            // image was suppressed rather than silently rendering nothing.
            if (typeof props.alt !== "string" || props.alt.length === 0) {
              props.alt = "(blocked image)";
            }
          }
        }
        // Strip any `srcset` regardless — we don't use it, and validating
        // each candidate URL adds complexity for zero benefit today. If a
        // future feature needs srcset, validate it here.
        delete props.srcset;
      }
    });
  };
};
