// Security tests for the markdown rendering pipeline.
//
// These exist to catch regressions in URL-scheme handling and raw-HTML
// pass-through. The pipeline has two defensive layers (remark-rehype's
// `allowDangerousHtml: false` and `rehypeSanitizeUrls`) and we exercise
// both here.

import { describe, it, expect } from "vitest";
import type { Root, Element, Properties } from "hast";
import { unified } from "unified";
import { renderMarkdown } from "../src/markdown/render";
import { rehypeSanitizeUrls } from "../src/markdown/sanitize-urls";

// Run the sanitizer transform over a single element and return it mutated.
// Lets us test rel hardening on `target`-carrying links directly, since the
// full markdown pipeline does not currently emit `target` on links.
function sanitizeElement(el: Element): Element {
    const tree: Root = { type: "root", children: [el] };
    unified().use(rehypeSanitizeUrls).runSync(tree);

    return tree.children[0] as Element;
}

function relTokens(el: Element): string[] {
    // Widened to hast's generic property value: `rel` is declared `string[]`,
    // but this helper must also report a non-array value the sanitizer under
    // test might emit.
    const rel = el.properties.rel as Properties[string];

    const raw = Array.isArray(rel) ? rel.map(String).join(" ") : String(rel ?? "");

    return raw.split(/\s+/).filter(Boolean).sort();
}

describe("renderMarkdown — security", () => {
    describe("URL scheme blocking on <a href>", () => {
        it.each([
            {
                name: "javascript:",
                markdown: "[click](javascript:alert(1))",
                scheme: "javascript:",
            },
            { name: "vbscript:", markdown: "[x](vbscript:msgbox(1))", scheme: "vbscript:" },
            {
                name: "data:text/html",
                markdown: "[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
                scheme: "data:",
            },
            { name: "file:", markdown: "[x](file:///etc/passwd)", scheme: "file:" },
        ])("blocks a $name link and marks it as blocked", async ({ markdown, scheme }) => {
            const html = await renderMarkdown(markdown);
            expect(html).not.toContain(`href="${scheme}`);
            expect(html).toContain("data-emr-blocked-scheme");
        });

        it("blocks an empty href and records the reason", async () => {
            const html = await renderMarkdown("[x]()");
            expect(html).not.toMatch(/href="/i);
            expect(html).toContain('data-emr-blocked-scheme="empty"');
        });

        it("blocks a raw-HTML javascript: link whose href is padded with whitespace", async () => {
            const html = await renderMarkdown('<a href=" javascript:alert(1)">x</a>\n');

            expect(html).not.toMatch(/href=/i);
            expect(html).toContain('data-emr-blocked-scheme="javascript:"');
        });

        it("preserves protocol-relative links", async () => {
            const html = await renderMarkdown("[x](//cdn.example.com/a)");
            expect(html).toContain('href="//cdn.example.com/a"');
        });

        it("blocks a javascript: link disguised with mixed case and a leading space", async () => {
            const html = await renderMarkdown("[x]( JaVaScRiPt:alert(1))");
            expect(html).not.toMatch(/href="[^"]*javascript:/i);
        });

        it("preserves safe http(s):, mailto:, tel:, ftp:, sftp: links", async () => {
            const html = await renderMarkdown(
                [
                    "[a](https://example.com)",
                    "[b](http://example.com)",
                    "[c](mailto:nobody@example.com)",
                    "[d](tel:+15555550100)",
                    "[e](ftp://files.example.com/x)",
                    "[f](sftp://files.example.com/y)",
                ].join("\n\n"),
            );

            expect(html).toContain('href="https://example.com"');
            expect(html).toContain('href="http://example.com"');
            expect(html).toContain('href="mailto:nobody@example.com"');
            expect(html).toContain('href="tel:+15555550100"');
            expect(html).toContain('href="ftp://files.example.com/x"');
            expect(html).toContain('href="sftp://files.example.com/y"');
        });

        it("preserves relative and fragment URLs", async () => {
            const html = await renderMarkdown(
                ["[a](#section)", "[b](./other.md)", "[c](/abs/path)"].join("\n\n"),
            );

            expect(html).toContain('href="#section"');
            expect(html).toContain('href="./other.md"');
            expect(html).toContain('href="/abs/path"');
        });

        it.each([
            { name: "a bare relative URL", markdown: "[doc](page.md)", href: "page.md" },
            {
                name: "a relative URL whose query contains a colon",
                markdown: "[open bugs](queries?q=state:active)",
                href: "queries?q=state:active",
            },
        ])("preserves $name", async ({ markdown, href }) => {
            const html = await renderMarkdown(markdown);
            expect(html).toContain(`href="${href}"`);
            expect(html).not.toContain("data-emr-blocked-scheme");
        });
    });

    describe("URL scheme blocking on <img src>", () => {
        it.each([
            { name: "javascript:", markdown: "![x](javascript:alert(1))", scheme: "javascript:" },
            {
                // SVG images can carry script payloads.
                name: "data:image/svg+xml",
                markdown:
                    "![x](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxzY3JpcHQ%2BYWxlcnQoMSk8L3NjcmlwdD48L3N2Zz4=)",
                scheme: "data:",
            },
            {
                name: "data:text/html",
                markdown: "![x](data:text/html,<script>alert(1)</script>)",
                scheme: "data:",
            },
        ])("blocks a $name image source and marks it as blocked", async ({ markdown, scheme }) => {
            const html = await renderMarkdown(markdown);
            expect(html).not.toContain(`src="${scheme}`);
            expect(html).toContain("data-emr-blocked-scheme");
        });

        it("falls back to alt='(blocked image)' when src is blocked and alt was empty", async () => {
            const html = await renderMarkdown("![](javascript:alert(1))");
            expect(html).toContain('alt="(blocked image)"');
        });

        it("labels a blocked raw-HTML image that has no alt at all", async () => {
            const html = await renderMarkdown('<img src="javascript:alert(1)">\n');

            expect(html).not.toMatch(/src=/i);
            expect(html).toContain('alt="(blocked image)"');
        });

        it("preserves the author's alt when src is blocked", async () => {
            const html = await renderMarkdown("![meaningful alt](javascript:alert(1))");

            expect(html).toContain('alt="meaningful alt"');
            expect(html).not.toMatch(/src="javascript:/i);
        });

        it.each(["https://example.com/logo.png", "http://intranet.example/logo.png"])(
            "preserves the safe image source %s",
            async (src) => {
                const html = await renderMarkdown(`![logo](${src})`);

                expect(html).toContain(`src="${src}"`);
            },
        );
    });

    describe("raw HTML pass-through", () => {
        it.each([
            { name: "<script>", markdown: "Hi <script>alert(1)</script> there", tag: "<script" },
            {
                name: "<iframe>",
                markdown: 'Hi <iframe src="https://evil.example/"></iframe> there',
                tag: "<iframe",
            },
            {
                name: "<object>",
                markdown: '<object data="javascript:alert(1)"></object>',
                tag: "<object",
            },
            { name: "<embed>", markdown: '<embed src="javascript:alert(1)" />', tag: "<embed" },
        ])("strips raw $name elements", async ({ markdown, tag }) => {
            const html = await renderMarkdown(markdown);

            expect(html).not.toContain(tag);
        });

        it("strips inline event handlers expressed as raw HTML", async () => {
            const html = await renderMarkdown(
                'Hi <a href="https://example.com" onclick="alert(1)">x</a>',
            );

            expect(html).not.toMatch(/onclick=/i);
        });
    });

    describe("rel hardening", () => {
        it("keeps plain Markdown links in the current tab (no target)", async () => {
            // rel hardening below only matters for links that open a new context;
            // if Markdown links ever gain a target, re-check `rehypeSanitizeUrls`.
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
                    // hast types rel as string[], but another plugin can set a plain
                    // string, which the sanitizer must also handle.
                    rel: "author help" as unknown as string[],
                },
                children: [],
            });

            expect(relTokens(out)).toEqual(["author", "help", "noopener", "noreferrer"]);
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

            expect(out.properties.rel).toBeUndefined();
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
            expect(out.properties.srcset).toBeUndefined();
        });
    });
});
