// Security tests for the markdown rendering pipeline.
//
// These exist to catch regressions in URL-scheme handling and raw-HTML
// pass-through. The pipeline has two defensive layers (remark-rehype's
// `allowDangerousHtml: false` and `rehypeSanitizeUrls`) and we exercise
// both here.

import { describe, it, expect } from "vitest";
import type { Root, Element } from "hast";
import { renderMarkdown } from "../src/markdown/render";
import { rehypeSanitizeUrls } from "../src/markdown/sanitize-urls";

// Run the sanitizer transform over a single element and return it mutated.
// Lets us test rel hardening on `target`-carrying links directly, since the
// full markdown pipeline does not currently emit `target` on links.
function sanitizeElement(el: Element): Element {
  const tree: Root = { type: "root", children: [el] };
  const transform = rehypeSanitizeUrls() as unknown as (t: Root) => void;
  transform(tree);
  return tree.children[0] as Element;
}

function relTokens(el: Element): string[] {
  const rel = el.properties?.rel;
  const raw = Array.isArray(rel)
    ? rel.map(String).join(" ")
    : String(rel ?? "");
  return raw.split(/\s+/).filter(Boolean).sort();
}

describe("renderMarkdown — security", () => {
  describe("URL scheme blocking on <a href>", () => {
    it("blocks javascript: links", async () => {
      const html = await renderMarkdown("[click](javascript:alert(1))");
      expect(html).not.toMatch(/href="javascript:/i);
      expect(html).toContain("data-emr-blocked-scheme");
    });

    it("blocks vbscript: links", async () => {
      const html = await renderMarkdown("[x](vbscript:msgbox(1))");
      expect(html).not.toMatch(/href="vbscript:/i);
      expect(html).toContain("data-emr-blocked-scheme");
    });

    it("blocks data:text/html links", async () => {
      const html = await renderMarkdown(
        "[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
      );
      expect(html).not.toMatch(/href="data:/i);
      expect(html).toContain("data-emr-blocked-scheme");
    });

    it("blocks file: links", async () => {
      const html = await renderMarkdown("[x](file:///etc/passwd)");
      expect(html).not.toMatch(/href="file:/i);
      expect(html).toContain("data-emr-blocked-scheme");
    });

    it("blocks an empty href and records the reason", async () => {
      const html = await renderMarkdown("[x]()");
      expect(html).not.toMatch(/href="/i);
      expect(html).toContain("data-emr-blocked-scheme");
    });

    it("preserves protocol-relative links", async () => {
      const html = await renderMarkdown("[x](//cdn.example.com/a)");
      expect(html).toContain('href="//cdn.example.com/a"');
    });

    it("ignores leading whitespace when classifying schemes", async () => {
      // `[x](   javascript:alert(1)   )` — markdown trims surrounding space
      // but defenders sometimes rely on case/spacing tricks. Verify both.
      const html = await renderMarkdown("[x]( JaVaScRiPt:alert(1))");
      expect(html).not.toMatch(/href="[^"]*javascript:/i);
    });

    it("preserves safe http(s):, mailto:, tel:, ftp: links", async () => {
      const html = await renderMarkdown(
        [
          "[a](https://example.com)",
          "[b](http://example.com)",
          "[c](mailto:nobody@example.com)",
          "[d](tel:+15555550100)",
          "[e](ftp://files.example.com/x)",
        ].join("\n\n"),
      );
      expect(html).toContain('href="https://example.com"');
      expect(html).toContain('href="http://example.com"');
      expect(html).toContain('href="mailto:nobody@example.com"');
      expect(html).toContain('href="tel:+15555550100"');
      expect(html).toContain('href="ftp://files.example.com/x"');
    });

    it("preserves relative and fragment URLs", async () => {
      const html = await renderMarkdown(
        ["[a](#section)", "[b](./other.md)", "[c](/abs/path)"].join("\n\n"),
      );
      expect(html).toContain('href="#section"');
      expect(html).toContain('href="./other.md"');
      expect(html).toContain('href="/abs/path"');
    });

    it("preserves a bare relative URL that has no scheme and no leading slash", async () => {
      const html = await renderMarkdown("[doc](page.md)");
      expect(html).toContain('href="page.md"');
      expect(html).not.toContain("data-emr-blocked-scheme");
    });
  });

  describe("URL scheme blocking on <img src>", () => {
    it("blocks javascript: image src", async () => {
      const html = await renderMarkdown("![x](javascript:alert(1))");
      expect(html).not.toMatch(/src="javascript:/i);
      expect(html).toContain("data-emr-blocked-scheme");
    });

    it("blocks data:image/svg+xml (can carry script payloads)", async () => {
      const html = await renderMarkdown(
        "![x](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxzY3JpcHQ%2BYWxlcnQoMSk8L3NjcmlwdD48L3N2Zz4=)",
      );
      expect(html).not.toMatch(/src="data:/i);
      expect(html).toContain("data-emr-blocked-scheme");
    });

    it("blocks data:text/html on img src", async () => {
      const html = await renderMarkdown(
        "![x](data:text/html,<script>alert(1)</script>)",
      );
      expect(html).not.toMatch(/src="data:/i);
      expect(html).toContain("data-emr-blocked-scheme");
    });

    it("falls back to alt='(blocked image)' when src is blocked and alt was empty", async () => {
      const html = await renderMarkdown("![](javascript:alert(1))");
      expect(html).toContain('alt="(blocked image)"');
    });

    it("preserves the author's alt when src is blocked", async () => {
      const html = await renderMarkdown(
        "![meaningful alt](javascript:alert(1))",
      );
      expect(html).toContain('alt="meaningful alt"');
      expect(html).not.toMatch(/src="javascript:/i);
    });

    it("preserves safe http(s) image sources", async () => {
      const html = await renderMarkdown(
        "![logo](https://example.com/logo.png)",
      );
      expect(html).toContain('src="https://example.com/logo.png"');
    });
  });

  describe("raw HTML pass-through", () => {
    it("strips <script> tags", async () => {
      const html = await renderMarkdown("Hi <script>alert(1)</script> there");
      expect(html).not.toMatch(/<script/i);
    });

    it("strips <iframe> tags", async () => {
      const html = await renderMarkdown(
        'Hi <iframe src="https://evil.example/"></iframe> there',
      );
      expect(html).not.toMatch(/<iframe/i);
    });

    it("strips inline event handlers expressed as raw HTML", async () => {
      const html = await renderMarkdown(
        'Hi <a href="https://example.com" onclick="alert(1)">x</a>',
      );
      expect(html).not.toMatch(/onclick=/i);
    });

    it("strips <object> and <embed>", async () => {
      const html = await renderMarkdown(
        '<object data="javascript:alert(1)"></object>' +
          '<embed src="javascript:alert(1)" />',
      );
      expect(html).not.toMatch(/<object/i);
      expect(html).not.toMatch(/<embed/i);
    });
  });

  describe("rel hardening", () => {
    it("does not emit target on plain markdown links (current renderer behavior)", async () => {
      // The pipeline currently does not add target=_blank. This test pins
      // that behavior so a future change is forced to also re-check
      // rel hardening in `rehypeSanitizeUrls`.
      const html = await renderMarkdown("[x](https://example.com)");
      expect(html).not.toMatch(/target=/i);
    });

    it("adds noopener/noreferrer to a new-context link without a rel", () => {
      const out = sanitizeElement({
        type: "element",
        tagName: "a",
        properties: { href: "https://example.com", target: "_blank" },
        children: [],
      });
      expect(relTokens(out)).toEqual(["noopener", "noreferrer"]);
    });

    it("merges an existing string rel with the required tokens", () => {
      const out = sanitizeElement({
        type: "element",
        tagName: "a",
        properties: {
          href: "https://example.com",
          target: "_blank",
          rel: "author help",
        },
        children: [],
      });
      expect(relTokens(out)).toEqual([
        "author",
        "help",
        "noopener",
        "noreferrer",
      ]);
    });

    it("merges an existing array rel with the required tokens", () => {
      const out = sanitizeElement({
        type: "element",
        tagName: "a",
        properties: {
          href: "https://example.com",
          target: "_blank",
          rel: ["author", "noopener"],
        },
        children: [],
      });
      expect(relTokens(out)).toEqual(["author", "noopener", "noreferrer"]);
    });

    it("does not harden rel when target is an empty string", () => {
      // An empty `target` doesn't open a new browsing context, so no rel
      // hardening is applied.
      const out = sanitizeElement({
        type: "element",
        tagName: "a",
        properties: { href: "https://example.com", target: "" },
        children: [],
      });
      expect(out.properties?.rel).toBeUndefined();
    });

    it("hardens rel on an href-less anchor that still opens a new context", () => {
      // An `<a target=_blank>` with no `href` still opens a new context, so it
      // gets rel hardening even though there's no URL scheme to classify.
      const out = sanitizeElement({
        type: "element",
        tagName: "a",
        properties: { target: "_blank" },
        children: [],
      });
      expect(out.properties).not.toHaveProperty("dataEmrBlockedScheme");
      expect(relTokens(out)).toEqual(["noopener", "noreferrer"]);
    });
  });

  describe("img without a src", () => {
    it("leaves a src-less <img> unblocked but still strips srcset", () => {
      // With no `src` there's no URL scheme to block; `srcset` is still
      // removed unconditionally.
      const out = sanitizeElement({
        type: "element",
        tagName: "img",
        properties: { alt: "x", srcset: "a.png 1x, b.png 2x" },
        children: [],
      });
      expect(out.properties).not.toHaveProperty("dataEmrBlockedScheme");
      expect(out.properties?.srcset).toBeUndefined();
    });
  });
});
