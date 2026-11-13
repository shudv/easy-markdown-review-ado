import { describe, it, expect } from "vitest";
import type { Root, RootContent } from "hast";
import { unified } from "unified";
import { renderMarkdown } from "../src/markdown/render";
import { rehypeSafeHtml } from "../src/markdown/safeHtml";
import {
    renderFrontmatterHtml,
    frontmatterValuesForKey,
    parseFrontmatterListItems,
} from "../src/markdown/frontmatter";

describe("renderMarkdown", () => {
    it("renders headings and paragraphs with source line attributes", async () => {
        const md = "# Title\n\nA paragraph.\n";
        const html = await renderMarkdown(md);

        expect(html).toContain("<h1");
        expect(html).toContain(">Title</h1>");
        expect(html).toContain("<p");
        expect(html).toContain("A paragraph.</p>");

        // Every block element gets data-source-line / data-source-end-line.
        expect(html).toMatch(/<h1\b[^>]+data-source-line="1"/);
        expect(html).toMatch(/<h1\b[^>]+data-source-end-line="1"/);
        expect(html).toMatch(/<p\b[^>]+data-source-line="3"/);
    });

    it("supports GFM tables", async () => {
        const md = ["| H1 | H2 |", "| -- | -- |", "| a  | b  |", ""].join("\n");
        const html = await renderMarkdown(md);
        expect(html).toContain("<table");
        expect(html).toContain("<th");
        expect(html).toContain(">H1</th>");
        expect(html).toContain(">a</td>");
    });

    it("supports GFM strikethrough and task lists", async () => {
        const md = ["- [x] done", "- [ ] todo", "", "~~struck~~", ""].join("\n");

        const html = await renderMarkdown(md);
        expect(html).toContain('type="checkbox"');
        // remark-gfm renders ~~struck~~ as a <del>. Source-position attrs may be
        // present on the tag so match permissively.
        expect(html).toMatch(/<del\b[^>]*>struck<\/del>/);
    });

    it("renders GitHub-style admonitions as semantic alert blocks", async () => {
        const html = await renderMarkdown("> [!NOTE]\n> The browser may omit capabilities.\n");

        expect(html).toMatch(/<blockquote\b[^>]+class="markdown-alert markdown-alert-note"/);
        expect(html).toContain('data-alert-kind="note"');
        expect(html).toContain('class="markdown-alert-title">Note</p>');
        expect(html).not.toContain("[!NOTE]");
    });

    it("recognizes an admonition marker nested in formatting", async () => {
        const html = await renderMarkdown("> **[!TIP]**\n> Use the safer path.\n");

        expect(html).toContain("markdown-alert-tip");
        expect(html).toContain('class="markdown-alert-title">Tip</p>');
    });

    it("labels footnotes and numbers repeated back links", async () => {
        const html = await renderMarkdown("One[^a] and two[^a].\n\n[^a]: Note.\n");

        expect(html).toContain(">Footnotes</h2>");
        expect(html).toContain('aria-label="Back to reference 1"');
        expect(html).toContain('aria-label="Back to reference 1-2"');
    });

    it("does not recognize an alert marker after formatted prefix text", async () => {
        const html = await renderMarkdown("> **Prefix** [!NOTE] ordinary text.\n");

        expect(html).not.toContain("markdown-alert");
    });

    it.each([
        { name: "a plain-text quote", markdown: "> Ordinary quote.\n" },
        { name: "a quote holding only an image", markdown: "> ![Preview](./preview.png)\n" },
        { name: "a quote holding only raw HTML", markdown: "> <details></details>\n" },
        {
            name: "a quote whose heading carries an alert marker",
            markdown: "> ## [!WARNING] Heads up\n> Body text.\n",
        },
        { name: "a quote mentioning [!NOTE] mid-sentence", markdown: "> See [!NOTE] below.\n" },
    ])("renders $name as an ordinary blockquote, not an alert", async ({ markdown }) => {
        const html = await renderMarkdown(markdown);

        expect(html).not.toContain("markdown-alert");
    });

    it("leaves a list item that opens with [!NOTE] as an ordinary item", async () => {
        const html = await renderMarkdown("- [!NOTE] Remember this\n\n- Other\n");

        expect(html).not.toContain("markdown-alert");
        expect(html).toContain("[!NOTE] Remember this");
    });

    it("keeps the words of a one-line alert after removing its marker", async () => {
        const root = document.createElement("div");
        root.innerHTML = await renderMarkdown("> [!TIP] Mind the gap.\n");

        expect(root.querySelector("blockquote > p:not(.markdown-alert-title)")!.textContent).toBe(
            "Mind the gap.",
        );
    });

    it("renders allowlisted details and Markdown inside them", async () => {
        const md = [
            "<details open>",
            "<summary>Common question</summary>",
            "",
            "The **safe answer** remains visible.",
            "",
            "</details>",
            "",
        ].join("\n");

        const html = await renderMarkdown(md);
        expect(html).toMatch(/<details\b[^>]+open/);
        expect(html).toContain("<summary>Common question</summary>");
        expect(html).toMatch(/<strong\b[^>]*>safe answer<\/strong>/);
        expect(html).toMatch(/<details\b[^>]+data-source-line="1"/);
        expect(html).toMatch(/<details\b[^>]+data-source-end-line="6"/);
    });

    it("filters raw HTML classes, attributes, and unsafe URLs", async () => {
        const md = [
            '<div class="card-grid evil" style="position:fixed" onclick="steal()">',
            '<a class="card evil" href="javascript:alert(1)" target="_blank">',
            '<i class="codicon codicon-extensions evil" aria-hidden="true"></i>',
            "<p>Extensions</p>",
            "</a>",
            "</div>",
            "",
        ].join("\n");

        const html = await renderMarkdown(md);
        expect(html).toContain('class="card-grid"');
        expect(html).toContain('class="card"');
        expect(html).toContain('class="codicon codicon-extensions"');
        expect(html).not.toContain("evil");
        expect(html).not.toContain("style=");
        expect(html).not.toContain("onclick");
        expect(html).not.toContain('href="javascript:');
        expect(html).toContain('data-emr-blocked-scheme="javascript:"');
        expect(html).toContain('rel="noopener noreferrer"');
    });

    it.each(["&#9;", "&#10;", "&#13;", "&#31;", "&#127;"])(
        "blocks raw HTML links with %s inside a script scheme",
        async (characterReference) => {
            const html = await renderMarkdown(
                `<a href="java${characterReference}script:alert(1)">Open</a>\n`,
            );

            expect(html).not.toContain("href=");
            expect(html).toContain('data-emr-blocked-scheme="control-character"');
        },
    );

    it("preserves the complete safe documentation attribute allowlist", async () => {
        const md = [
            '<div class="docs-action" data-show-in-doc="true" data-show-in-sidebar="false" id="start" title="Start">',
            '<a href="https://example.com" target="_self" rel="external" aria-label="Open docs">Docs</a>',
            '<a href="https://example.com/other" target="_parent">Other</a>',
            '<img src="./preview.png" alt="Preview" width="320" height="wide">',
            '<span aria-hidden="false">Visible</span>',
            "</div>",
            "<!-- safe comment is intentionally omitted -->",
            "",
        ].join("\n");

        const html = await renderMarkdown(md);
        expect(html).toContain('id="start"');
        expect(html).toContain('title="Start"');
        expect(html).toContain('data-show-in-doc="true"');
        expect(html).toContain('data-show-in-sidebar="false"');
        expect(html).toContain('href="https://example.com"');
        expect(html).toContain('target="_self"');
        expect(html).not.toContain('target="_parent"');
        expect(html).toContain('rel="noopener noreferrer external"');
        expect(html).toContain('aria-label="Open docs"');
        expect(html).toContain('src="./preview.png"');
        expect(html).toContain('alt="Preview"');
        expect(html).toContain('width="320"');
        expect(html).not.toContain('height="wide"');
        expect(html).toContain('aria-hidden="false"');
        expect(html).not.toContain("safe comment");
    });

    it("keeps the text of a raw span whose only class is not allowlisted", async () => {
        const html = await renderMarkdown('<span class="evil">Plain</span>\n');

        expect(html).toMatch(/<span\b[^>]*>Plain<\/span>/);
        expect(html).not.toContain("evil");
    });

    it("drops allowlisted attributes placed on the wrong element, and unknown or prototype-named attributes", async () => {
        const tree: Root = {
            type: "root",
            children: [
                {
                    type: "raw",
                    value: '<span class="evil" open href="https://example.com" target="_blank" rel="x" src="a.png" alt="A" width="5" height="34" data-show-in-doc="true" data-show-in-sidebar="no" constructor="x" __proto__="x">Text</span>',
                } as unknown as RootContent,
            ],
        };

        await unified().use(rehypeSafeHtml).run(tree);

        expect(tree.children).toEqual([
            {
                type: "element",
                tagName: "span",
                properties: {},
                children: [{ type: "text", value: "Text" }],
            },
        ]);
    });

    it("ignores a mismatched raw closing tag without escaping the safe container", async () => {
        const html = await renderMarkdown(
            [
                "<details>",
                "<summary>Question</summary>",
                "</div>",
                "Answer.",
                "</details>",
                "",
            ].join("\n"),
        );

        expect(html).toMatch(/<details\b[^>]*>[\s\S]*Answer\.[\s\S]*<\/details>/);
    });

    it("ignores an orphan raw closing tag", async () => {
        const tree: Root = {
            type: "root",
            children: [
                { type: "raw", value: "</details>" } as unknown as RootContent,
                { type: "text", value: "Visible." },
            ],
        };

        await unified().use(rehypeSafeHtml).run(tree);

        expect(tree.children).toEqual([{ type: "text", value: "Visible." }]);
    });

    it("supports safe raw containers without source positions", async () => {
        const tree: Root = {
            type: "root",
            children: [
                { type: "raw", value: "<details>" } as unknown as RootContent,
                { type: "text", value: "Answer." },
                { type: "raw", value: "</details>" } as unknown as RootContent,
            ],
        };

        await unified().use(rehypeSafeHtml).run(tree);

        expect(tree.children).toEqual([
            {
                type: "element",
                tagName: "details",
                properties: {},
                children: [{ type: "text", value: "Answer." }],
                position: undefined,
            },
        ]);
    });

    it("scopes every safe raw attribute to its intended tag and value", async () => {
        const tree: Root = {
            type: "root",
            children: [
                {
                    type: "raw",
                    value: '<details class="card evil" open="no"><a href="/docs" target="_blank" rel="  external   help  " aria-label="Docs"><img src="x.png" alt="X" width="12" height="34"><span aria-hidden="unexpected" data-show-in-doc="wrong">Text</span><div data-show-in-doc="yes" data-show-in-sidebar="no"></div></a></details>',
                } as unknown as RootContent,
            ],
        };

        await unified().use(rehypeSafeHtml).run(tree);

        expect(tree.children).toEqual([
            {
                type: "element",
                tagName: "details",
                properties: { className: ["card"], open: true },
                children: [
                    {
                        type: "element",
                        tagName: "a",
                        properties: {
                            href: "/docs",
                            target: "_blank",
                            rel: ["external", "help"],
                            ariaLabel: "Docs",
                        },
                        children: [
                            {
                                type: "element",
                                tagName: "img",
                                properties: {
                                    src: "x.png",
                                    alt: "X",
                                    width: 12,
                                    height: 34,
                                },
                                children: [],
                            },
                            {
                                type: "element",
                                tagName: "span",
                                properties: { ariaHidden: "true" },
                                children: [{ type: "text", value: "Text" }],
                            },
                            {
                                type: "element",
                                tagName: "div",
                                properties: {
                                    dataShowInDoc: "yes",
                                    dataShowInSidebar: "no",
                                },
                                children: [],
                            },
                        ],
                    },
                ],
            },
        ]);
    });

    it("accepts only fully numeric image dimensions", async () => {
        const tree: Root = {
            type: "root",
            children: [
                {
                    type: "raw",
                    value: '<div><img src="a" width="12x"><img src="b" width="x12"><img src="c" width="12.5"><p width="12">Text</p></div>',
                } as unknown as RootContent,
            ],
        };

        await unified().use(rehypeSafeHtml).run(tree);

        const container = tree.children[0];
        expect(container).toMatchObject({ type: "element", tagName: "div" });
        expect((container as { children: RootContent[] }).children).toEqual([
            {
                type: "element",
                tagName: "img",
                properties: { src: "a" },
                children: [],
            },
            {
                type: "element",
                tagName: "img",
                properties: { src: "b" },
                children: [],
            },
            {
                type: "element",
                tagName: "img",
                properties: { src: "c" },
                children: [],
            },
            {
                type: "element",
                tagName: "p",
                properties: {},
                children: [{ type: "text", value: "Text" }],
            },
        ]);
    });

    it.each(["iframe", "object", "script", "style", "template"])(
        "drops the complete %s subtree",
        async (tagName) => {
            const tree: Root = {
                type: "root",
                children: [
                    {
                        type: "raw",
                        value: `<div>Before<${tagName}><span>Hidden</span></${tagName}>After</div>`,
                    } as unknown as RootContent,
                ],
            };

            await unified().use(rehypeSafeHtml).run(tree);

            expect(JSON.stringify(tree)).not.toContain("Hidden");
            expect(JSON.stringify(tree)).toContain("Before");
            expect(JSON.stringify(tree)).toContain("After");
        },
    );

    it.each(["<details>Inline</details>", "<DETAILS>Inline</DETAILS>"])(
        "keeps content after a one-line %s outside the details",
        async (value) => {
            const tree: Root = {
                type: "root",
                children: [
                    { type: "raw", value } as unknown as RootContent,
                    { type: "text", value: "After" },
                ],
            };

            await unified().use(rehypeSafeHtml).run(tree);

            expect(tree.children).toHaveLength(2);
            expect(tree.children[1]).toEqual({ type: "text", value: "After" });
        },
    );

    it("closes a raw container whose closing tag has a space before '>'", async () => {
        const tree: Root = {
            type: "root",
            children: [
                { type: "raw", value: "<details>" } as unknown as RootContent,
                { type: "text", value: "Inside" },
                { type: "raw", value: "</details >" } as unknown as RootContent,
                { type: "text", value: "After" },
            ],
        };

        await unified().use(rehypeSafeHtml).run(tree);

        expect(tree.children).toEqual([
            expect.objectContaining({
                tagName: "details",
                children: [{ type: "text", value: "Inside" }],
            }),
            { type: "text", value: "After" },
        ]);
    });

    it("leaves a raw container without a source line when only its closing tag has one", async () => {
        const tree: Root = {
            type: "root",
            children: [
                { type: "raw", value: "<details>" } as unknown as RootContent,
                { type: "text", value: "Inside" },
                {
                    type: "raw",
                    value: "</details>",
                    position: {
                        start: { line: 2, column: 1, offset: 10 },
                        end: { line: 2, column: 11, offset: 20 },
                    },
                } as unknown as RootContent,
            ],
        };

        await unified().use(rehypeSafeHtml).run(tree);

        expect(tree.children[0]).toMatchObject({
            type: "element",
            tagName: "details",
            position: undefined,
        });
    });

    it("recognises an indented, upper-case raw <DETAILS> container and its closing tag", async () => {
        const tree: Root = {
            type: "root",
            children: [
                {
                    type: "raw",
                    value: '  <DETAILS data-x="ignored">',
                } as unknown as RootContent,
                { type: "text", value: "Inside" },
                {
                    type: "raw",
                    value: " </DETAILS> ",
                } as unknown as RootContent,
                { type: "text", value: "After" },
            ],
        };

        await unified().use(rehypeSafeHtml).run(tree);

        expect(tree.children).toEqual([
            { type: "text", value: "  ", position: undefined },
            {
                type: "element",
                tagName: "details",
                properties: {},
                children: [{ type: "text", value: "Inside" }],
                position: undefined,
            },
            { type: "text", value: "After" },
        ]);
    });

    it("keeps content after a raw <br> as its sibling, never inside the void tag", async () => {
        const tree: Root = {
            type: "root",
            children: [
                { type: "raw", value: "<br>" } as unknown as RootContent,
                { type: "text", value: "After" },
            ],
        };

        await unified().use(rehypeSafeHtml).run(tree);

        expect(tree.children).toEqual([
            {
                type: "element",
                tagName: "br",
                properties: {},
                children: [],
                position: undefined,
            },
            { type: "text", value: "After" },
        ]);
    });

    it("flattens unknown MDX wrappers while keeping Markdown content", async () => {
        const html = await renderMarkdown(
            ["<Note>", "", "Keep **this text**.", "", "</Note>", ""].join("\n"),
        );

        expect(html).not.toContain("<note");
        expect(html).toMatch(/Keep <strong\b[^>]*>this text<\/strong>\./);
    });

    it("renders fenced code blocks", async () => {
        const md = "```ts\nconst x = 1;\n```\n";
        const html = await renderMarkdown(md);
        expect(html).toMatch(/<pre\b/);
        expect(html).toMatch(/<code\b[^>]+class="language-ts"/);
        expect(html).toContain("const x = 1;");
    });

    it("preserves fenced-code metadata for rendered diff comparison", async () => {
        const html = await renderMarkdown('```js [[1, 3, "updateName"]]\nconst x = 1;\n```\n');

        expect(html).toContain('data-code-meta="[[1, 3, &#x22;updateName&#x22;]]"');
    });

    it("stamps a multi-line code block with its first and last source lines", async () => {
        // Comments anchor to a block's whole source range, so a fenced block that
        // spans lines 1-4 must report both ends, not just its opening fence.
        const md = "```ts\nconst x = 1;\nconst y = 2;\n```\n";
        const html = await renderMarkdown(md);
        const preTag = /<pre\b[^>]*>/.exec(html)?.[0] ?? "";
        expect(preTag).toMatch(/data-source-line="1"/);
        expect(preTag).toMatch(/data-source-end-line="4"/);
    });
});

function parseHtml(html: string): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = html;

    return root;
}

/** The `data-section-id`s of every rendered section, in document order. */
function sectionIds(html: string): string[] {
    return Array.from(
        parseHtml(html).querySelectorAll<HTMLElement>("section[data-section-id]"),
        (section) => section.dataset.sectionId!,
    );
}

describe("renderMarkdown — collapsible sections & heading anchors", () => {
    it("wraps a heading and its body in a section keyed by the heading's slug", async () => {
        const html = await renderMarkdown("# Hello World\n\nBody text.\n");
        expect(html).toMatch(
            /<section\b[^>]+class="emr-section emr-section-level-1 emr-section--doc-title"[^>]*data-section-id="hello-world"[^>]*data-section-level="1"/,
        );
        // The heading keeps a matching id for DocNav / anchor jumps.
        expect(html).toMatch(/<h1\b[^>]+id="hello-world"/);
        expect(parseHtml(html).querySelector("section")!.textContent).toContain("Body text.");
    });

    it("builds a heading's link anchor from its words, dropping punctuation", async () => {
        // Readers link to `#foo-bar-baz-qux`; punctuation is dropped and runs of
        // spaces, underscores and dashes become a single dash.
        const html = await renderMarkdown("## Foo, Bar_Baz -- Qux!\n");
        expect(html).toMatch(/<h2\b[^>]+id="foo-bar-baz-qux"/);
        expect(sectionIds(html)).toEqual(["foo-bar-baz-qux"]);
    });

    it("gives a heading with no letters or digits the anchor 'section'", async () => {
        const html = await renderMarkdown("### !!! ???\n");
        expect(sectionIds(html)).toEqual(["section"]);
    });

    it("drops the underscores around a heading like `__init__` from its anchor", async () => {
        const html = await renderMarkdown("## `__init__`\n");
        expect(sectionIds(html)).toEqual(["init"]);
    });

    it("gives repeated headings distinct anchors: the first keeps the slug, the next gets -2", async () => {
        const html = await renderMarkdown("## Setup\n\n## Setup\n");
        expect(sectionIds(html)).toEqual(["setup", "setup-2"]);
        expect(Array.from(parseHtml(html).querySelectorAll("h2"), (h) => h.id)).toEqual([
            "setup",
            "setup-2",
        ]);
    });

    it("nests a subsection inside its parent heading's section", async () => {
        const root = parseHtml(await renderMarkdown("# Parent\n\n## Child\n\ntext\n"));
        const parent = root.querySelector('[data-section-id="parent"]')!;
        const child = root.querySelector('[data-section-id="child"]')!;

        expect(child.parentElement!.closest("section")).toBe(parent);
        expect(child.classList.contains("emr-section-level-2")).toBe(true);
    });

    it("keeps consecutive same-level headings as sibling sections", async () => {
        const root = parseHtml(await renderMarkdown("## First\n\nA\n\n## Second\n\nB\n"));
        const first = root.querySelector('[data-section-id="first"]')!;
        const second = root.querySelector('[data-section-id="second"]')!;

        expect(first.contains(second)).toBe(false);
        expect(second.parentElement).toBe(first.parentElement);
    });

    it("marks the single outermost section as the document title", async () => {
        // One top-level heading that wraps the whole doc → its section is the
        // title and carries `emr-section--doc-title` (the UI drops its chevron).
        const root = parseHtml(await renderMarkdown("# Title\n\nBody.\n\n## Sub\n\nMore.\n"));

        const titleSections = Array.from(
            root.querySelectorAll<HTMLElement>(".emr-section--doc-title"),
            (section) => section.dataset.sectionId,
        );

        expect(titleSections).toEqual(["title"]);
    });

    it("marks the title section even when the document opens with an HTML comment", async () => {
        const root = parseHtml(
            await renderMarkdown("<!-- markdownlint-disable -->\n# Title\n\nBody.\n"),
        );

        expect(root.querySelector(".emr-section--doc-title")?.getAttribute("data-section-id")).toBe(
            "title",
        );
    });

    it.each([
        ["the document has multiple top-level headings", "# One\n\nA\n\n# Two\n\nB\n"],
        ["content precedes the first heading", "Intro paragraph.\n\n# Heading\n\nBody.\n"],
        ["the document has no heading at all", "Just a paragraph, no headings.\n"],
    ])("marks no title when %s", async (_case, markdown) => {
        const html = await renderMarkdown(markdown);
        expect(html).not.toContain("emr-section--doc-title");
    });
});

describe("renderMarkdown — YAML frontmatter", () => {
    it("renders a leading frontmatter block as a metadata card", async () => {
        const md = [
            "---",
            "title: Release Notes",
            "author: Ada Lovelace",
            "---",
            "",
            "# Heading",
            "",
            "Body text.",
            "",
        ].join("\n");

        const html = await renderMarkdown(md);

        // A styled metadata card is emitted before the article body.
        expect(html).toMatch(/<div class="emr-frontmatter"/);
        expect(html).toContain('<dl class="emr-frontmatter-grid">');
        expect(html).toContain('<dt class="emr-frontmatter-key">title</dt>');
        expect(html).toContain('<dd class="emr-frontmatter-value">Release Notes</dd>');
        expect(html).toContain('<dt class="emr-frontmatter-key">author</dt>');
        expect(html).toContain('<dd class="emr-frontmatter-value">Ada Lovelace</dd>');

        // The card comes first, then the rendered heading.
        expect(html.indexOf("emr-frontmatter")).toBeLessThan(html.indexOf("<h1"));
        // The raw `---` fence and key/value lines never leak into the prose.
        expect(html).not.toContain("<hr");
        expect(html).not.toContain("title: Release Notes");
    });

    it("preserves body source line numbers after stripping frontmatter", async () => {
        // `# Heading` sits on source line 6; anchoring must still report line 6.
        const md = ["---", "title: Doc", "tags: [a, b]", "---", "", "# Heading", ""].join("\n");

        const html = await renderMarkdown(md);
        expect(html).toMatch(/<h1\b[^>]+data-source-line="6"/);
    });

    it("stamps the metadata card with the frontmatter source line span", async () => {
        // The block occupies source lines 1-4 (open fence, two entries, close).
        const md = ["---", "title: Doc", "author: Ann", "---", "", "# Heading", ""].join("\n");

        const html = await renderMarkdown(md);
        const card = /<div class="emr-frontmatter"[^>]*>/.exec(html)?.[0] ?? "";
        expect(card).toMatch(/data-source-line="1"/);
        expect(card).toMatch(/data-source-end-line="4"/);
    });

    it("stamps the card's span when the document is only frontmatter, with no final newline", async () => {
        const html = await renderMarkdown(["---", "title: Doc", "---"].join("\n"));

        const card = /<div class="emr-frontmatter"[^>]*>/.exec(html)?.[0] ?? "";
        expect(card).toMatch(/data-source-line="1"/);
        expect(card).toMatch(/data-source-end-line="3"/);
    });

    it("stamps each key row with its own source line for granular diffing", async () => {
        // title -> source line 2, author -> source line 3.
        const md = ["---", "title: Doc", "author: Ann", "---", "", "Body.", ""].join("\n");

        const html = await renderMarkdown(md);

        const rows = [...html.matchAll(/<div class="emr-frontmatter-row"[^>]*>/g)].map((m) => m[0]);

        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatch(/data-source-line="2"[^>]*data-source-end-line="2"/);
        expect(rows[1]).toMatch(/data-source-line="3"[^>]*data-source-end-line="3"/);
    });

    it("spans a block-list row from its key line to its last item line", async () => {
        // reviewers key on line 2, items on lines 3 and 4 -> row spans 2..4.
        const md = ["---", "reviewers:", "  - Ann", "  - Bob", "---", "", "Body.", ""].join("\n");

        const html = await renderMarkdown(md);

        const row = /<div class="emr-frontmatter-row"[^>]*>/.exec(html)?.[0] ?? "";

        expect(row).toMatch(/data-source-line="2"/);
        expect(row).toMatch(/data-source-end-line="4"/);
    });

    it("omits source-line attributes when no range is supplied", () => {
        // Direct call without a source range (e.g. standalone card rendering).
        const html = renderFrontmatterHtml([{ key: "title", values: ["Doc"] }]);
        expect(html).toContain('class="emr-frontmatter"');
        expect(html).not.toContain("data-source-line");
        expect(html).not.toContain("data-source-end-line");
    });

    it("defaults a row's end line to its start line when only startLine is set", () => {
        const html = renderFrontmatterHtml([{ key: "title", values: ["Doc"], startLine: 3 }]);

        expect(html).toMatch(/data-source-line="3"/);
        expect(html).toMatch(/data-source-end-line="3"/);
    });

    it("renders inline and block YAML lists as comma-separated values", async () => {
        const md = [
            "---",
            "tags: [alpha, beta]",
            "reviewers:",
            "  - Ann",
            "  - ",
            "  - Bob",
            "---",
            "",
            "Body.",
            "",
        ].join("\n");

        const html = await renderMarkdown(md);
        expect(html).toContain('<dd class="emr-frontmatter-value">alpha, beta</dd>');
        // The blank `-` item is skipped; the two real reviewers join with a comma.
        expect(html).toContain('<dd class="emr-frontmatter-value">Ann, Bob</dd>');
        // No pill markup any more.
        expect(html).not.toContain("emr-frontmatter-tag");
    });

    it("strips surrounding quotes from scalar values", async () => {
        const md = [
            "---",
            'title: "Quoted Title"',
            "author: 'Ada Lovelace'",
            "---",
            "",
            "Body.",
            "",
        ].join("\n");

        const html = await renderMarkdown(md);
        expect(html).toContain('<dd class="emr-frontmatter-value">Quoted Title</dd>');
        expect(html).toContain('<dd class="emr-frontmatter-value">Ada Lovelace</dd>');
    });

    it("escapes HTML in frontmatter values (XSS-safe)", async () => {
        const md = ["---", "title: <img src=x onerror=alert(1)>", "---", "", "Body.", ""].join(
            "\n",
        );

        const html = await renderMarkdown(md);
        expect(html).not.toContain("<img src=x");
        expect(html).toContain("&#x3C;img");
    });

    it("does not treat thematic breaks in the body as frontmatter", async () => {
        const md = ["# Heading", "", "---", "", "More text.", "", "---", "", "End.", ""].join("\n");
        const html = await renderMarkdown(md);
        expect(html).not.toContain("emr-frontmatter");
        // Thematic breaks in the body stay real <hr>s.
        expect(html.match(/<hr/g)).toHaveLength(2);
        expect(html).toContain("More text.");
    });

    it("strips an empty frontmatter block without emitting a card or an <hr>", async () => {
        // `---\n---` must be lifted out (matched by the regex), not rendered as a
        // thematic break leaking into the body.
        const md = ["---", "---", "", "Body.", ""].join("\n");
        const html = await renderMarkdown(md);
        expect(html).not.toContain("emr-frontmatter");
        expect(html).not.toContain("<hr");
        expect(html).toContain("Body.");
    });

    it("renders an empty frontmatter block as nothing, leaving only the body", async () => {
        // The two fence lines become blank lines, so `Body.` keeps source line 4.
        const html = await renderMarkdown(["---", "---", "", "Body.", ""].join("\n"));

        expect(html).toBe(await renderMarkdown(["", "", "", "Body.", ""].join("\n")));
    });

    it("skips comments, blank lines, and malformed non key:value lines", async () => {
        const md = [
            "---",
            "# a leading comment",
            "",
            "title: Doc",
            "just-a-loose-line-without-a-colon",
            "---",
            "",
            "Body.",
            "",
        ].join("\n");

        const html = await renderMarkdown(md);
        // The one valid pair renders; the comment / blank / malformed lines vanish.
        expect(html).toContain('<dt class="emr-frontmatter-key">title</dt>');
        expect(html).toContain('<dd class="emr-frontmatter-value">Doc</dd>');
        expect(html).not.toContain("a leading comment");
        expect(html).not.toContain("just-a-loose-line");
    });

    it("renders a bare key with no value as an empty value cell", async () => {
        const md = ["---", "summary:", "---", "", "Body.", ""].join("\n");
        const html = await renderMarkdown(md);
        expect(html).toContain('<dt class="emr-frontmatter-key">summary</dt>');
        expect(html).toContain('<dd class="emr-frontmatter-value"></dd>');
    });

    it("ignores an orphan list item that precedes any key", async () => {
        const md = ["---", "  - orphan", "title: Doc", "---", "", "Body.", ""].join("\n");

        const html = await renderMarkdown(md);
        expect(html).toContain('<dt class="emr-frontmatter-key">title</dt>');
        expect(html).not.toContain("orphan");
    });

    it("renders nothing when the block contains only comments", async () => {
        const md = ["---", "# just a note", "---", "", "Body.", ""].join("\n");
        const html = await renderMarkdown(md);
        expect(html).not.toContain("emr-frontmatter");
        expect(html).toContain("Body.");
    });
});

describe("frontmatterValuesForKey", () => {
    it("returns the inline-list values for a matching key", () => {
        expect(frontmatterValuesForKey("tags: [a, b, c]", "tags")).toEqual(["a", "b", "c"]);
    });

    it("returns block-list values for a matching key", () => {
        const src = ["reviewers:", "  - Ann", "  - Bob"].join("\n");
        expect(frontmatterValuesForKey(src, "reviewers")).toEqual(["Ann", "Bob"]);
    });

    it("returns a single-element list for a scalar key", () => {
        expect(frontmatterValuesForKey("status: Draft", "status")).toEqual(["Draft"]);
    });

    it("returns null when the key is absent", () => {
        expect(frontmatterValuesForKey("title: Doc", "tags")).toBeNull();
    });

    it("treats a commented-out `# key: value` line as a comment, not a key", () => {
        expect(frontmatterValuesForKey("title: Doc\n# note: x", "# note")).toBeNull();
        expect(frontmatterValuesForKey("title: Doc\n# note: x", "title")).toEqual(["Doc"]);
    });

    it("treats an unclosed `[` value as a scalar, not an inline list", () => {
        expect(frontmatterValuesForKey("k: [broken", "k")).toEqual(["[broken"]);
    });

    it("drops empty items from an inline list", () => {
        expect(frontmatterValuesForKey("k: [a, , b]", "k")).toEqual(["a", "b"]);
    });

    it('reads an empty quoted value `""` as an empty string', () => {
        expect(frontmatterValuesForKey('k: ""', "k")).toEqual([""]);
    });

    it.each([
        {
            name: "trims spaces and tabs around a scalar but keeps inner spaces",
            src: "k:    v  w \t",
            expected: ["v  w"],
        },
        {
            name: "reads a key followed only by tabs as having no values",
            src: "k:\t\t",
            expected: [],
        },
        { name: "reads a bare key as having no values", src: "k:", expected: [] },
        {
            name: "reads block-list items indented and padded with tabs",
            src: "k:\n \t-  \tItem  \t\n\t- next",
            expected: ["Item", "next"],
        },
        { name: "skips a blank block-list item", src: "k:\n  -   \n  - a", expected: ["a"] },
        { name: "ignores a `-x` line with no space after the dash", src: "k:\n  -x", expected: [] },
        {
            name: "ignores a block-list item holding a lone carriage return",
            src: "k:\n  - a\rb",
            expected: [],
        },
        {
            name: "reads a key written with a space before its colon",
            src: "k : v",
            expected: ["v"],
        },
        { name: "keeps a value that is a lone quote character", src: 'k: "', expected: ['"'] },
        {
            name: "keeps the quotes on a value that only starts with a quoted word",
            src: 'k: "Draft" for review',
            expected: ['"Draft" for review'],
        },
        {
            name: "keeps a scalar that only ends in a bracket",
            src: "k: Notes [draft]",
            expected: ["Notes [draft]"],
        },
        {
            name: "ignores list items under a key that already has a value",
            src: "k: v\n  - stray",
            expected: ["v"],
        },
    ])("$name", ({ src, expected }) => {
        expect(frontmatterValuesForKey(src, "k")).toEqual(expected);
    });

    it("does not lift an indented nested key to the top level", () => {
        expect(frontmatterValuesForKey("author:\n  name: Ada", "name")).toBeNull();
    });

    it("skips a `key: value` line holding a lone carriage return", () => {
        expect(frontmatterValuesForKey("k: a\rb", "k")).toBeNull();
    });

    it("handles long whitespace runs without catastrophic backtracking", () => {
        const spaces = " ".repeat(100_000);
        expect(frontmatterValuesForKey(`k:${spaces}\r`, "k")).toBeNull();
        expect(frontmatterValuesForKey(`k:\n -${spaces}\r`, "k")).toEqual([]);
        expect(parseFrontmatterListItems(`-${spaces}\r`)).toEqual([]);
    });
});

describe("parseFrontmatterListItems", () => {
    it("parses bare `- item` lines, unquoting and skipping blanks", () => {
        const fragment = ["  - Ada Lovelace", '  - "Grace Hopper"', "  - "].join("\n");

        expect(parseFrontmatterListItems(fragment)).toEqual(["Ada Lovelace", "Grace Hopper"]);
    });

    it("returns an empty array when there are no item lines", () => {
        expect(parseFrontmatterListItems("status: Draft")).toEqual([]);
    });

    it.each([
        {
            name: "reads a tab after the dash as a separator",
            fragment: "-\titem",
            expected: ["item"],
        },
        { name: "trims tabs and spaces around an item", fragment: "\t-  x \t", expected: ["x"] },
        { name: "skips an item that is only whitespace", fragment: "-   ", expected: [] },
        { name: "ignores a `-x` line with no space after the dash", fragment: "-x", expected: [] },
        {
            name: "ignores an item holding a lone carriage return",
            fragment: "  - a\rb",
            expected: [],
        },
    ])("$name", ({ fragment, expected }) => {
        expect(parseFrontmatterListItems(fragment)).toEqual(expected);
    });
});
