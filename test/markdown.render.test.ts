import { describe, it, expect } from "vitest";
import type { Root, RootContent } from "hast";
import { unified } from "unified";
import { renderMarkdown, sanitizeCssColor } from "../src/markdown/render";
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
    expect(html).toMatch(/<h1\b[^>]*data-source-line="1"/);
    expect(html).toMatch(/<h1\b[^>]*data-source-end-line="1"/);
    expect(html).toMatch(/<p\b[^>]*data-source-line="3"/);
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
    const html = await renderMarkdown(
      "> [!NOTE]\n> The browser may omit capabilities.\n",
    );
    expect(html).toMatch(
      /<blockquote\b[^>]*class="markdown-alert markdown-alert-note"/,
    );
    expect(html).toContain('data-alert-kind="note"');
    expect(html).toContain('class="markdown-alert-title">Note</p>');
    expect(html).not.toContain("[!NOTE]");
  });

  it("recognizes an admonition marker nested in formatting", async () => {
    const html = await renderMarkdown("> **[!TIP]**\n> Use the safer path.\n");
    expect(html).toContain("markdown-alert-tip");
    expect(html).toContain('class="markdown-alert-title">Tip</p>');
  });

  it("does not recognize an alert marker after formatted prefix text", async () => {
    const html = await renderMarkdown("> **Prefix** [!NOTE] ordinary text.\n");
    expect(html).not.toContain("markdown-alert");
  });

  it("leaves ordinary and element-only blockquotes as ordinary quotes", async () => {
    const ordinary = await renderMarkdown("> Ordinary quote.\n");
    expect(ordinary).not.toContain("markdown-alert");
    const imageOnly = await renderMarkdown("> ![Preview](./preview.png)\n");
    expect(imageOnly).not.toContain("markdown-alert");
    const detailsOnly = await renderMarkdown("> <details></details>\n");
    expect(detailsOnly).not.toContain("markdown-alert");
  });

  it("drops dangerous raw HTML", async () => {
    const md = "Hello <script>alert(1)</script> world\n";
    const html = await renderMarkdown(md);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("</script>");
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
    expect(html).toMatch(/<details\b[^>]*open/);
    expect(html).toContain("<summary>Common question</summary>");
    expect(html).toMatch(/<strong\b[^>]*>safe answer<\/strong>/);
    expect(html).toMatch(/<details\b[^>]*data-source-line="1"/);
    expect(html).toMatch(/<details\b[^>]*data-source-end-line="6"/);
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

  it.each(["&#9;", "&#10;", "&#13;", "&#127;"])(
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
    const unsafeClassOnly = await renderMarkdown(
      '<span class="evil">Plain</span>\n',
    );
    expect(unsafeClassOnly).toMatch(/<span\b[^>]*>Plain<\/span>/);
    expect(unsafeClassOnly).not.toContain("evil");
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
          value:
            '<details class="card evil" open="no"><a href="/docs" target="_blank" rel="  external   help  " aria-label="Docs"><img src="x.png" alt="X" width="12" height="34"><span aria-hidden="unexpected" data-show-in-doc="wrong">Text</span><div data-show-in-doc="yes" data-show-in-sidebar="no"></div></a></details>',
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

  it("rejects safe attributes when they appear on the wrong element", async () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "raw",
          value:
            '<span class="evil" open href="/wrong" target="_self" rel="help" src="wrong.png" alt="Wrong" width="12" height="34" data-show-in-doc="yes" data-show-in-sidebar="no">Text</span>',
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

  it("accepts only fully numeric image dimensions", async () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "raw",
          value:
            '<div><img src="a" width="12x"><img src="b" width="x12"><img src="c" width="12.5"><p width="12">Text</p></div>',
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

  it("does not leave an inline-closed container active", async () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "raw",
          value: "<details>Inline</details>",
        } as unknown as RootContent,
        { type: "text", value: "After" },
      ],
    };

    await unified().use(rehypeSafeHtml).run(tree);

    expect(tree.children).toHaveLength(2);
    expect(tree.children[1]).toEqual({ type: "text", value: "After" });
  });

  it("updates a container end only when both source positions exist", async () => {
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

  it("parses spaced mixed-case containers but never stacks content under void tags", async () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "raw",
          value: '  <DETAILS data-x="ignored">',
        } as unknown as RootContent,
        { type: "text", value: "Inside" },
        { type: "raw", value: " </DETAILS> " } as unknown as RootContent,
        { type: "raw", value: "<br>" } as unknown as RootContent,
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
    expect(html).toMatch(/<code\b[^>]*class="language-ts"/);
    expect(html).toContain("const x = 1;");
  });

  it("preserves fenced-code metadata for rendered diff comparison", async () => {
    const html = await renderMarkdown(
      '```js [[1, 3, "updateName"]]\nconst x = 1;\n```\n',
    );
    expect(html).toContain('data-code-meta="[[1, 3, &#x22;updateName&#x22;]]"');
  });

  it("maps data-source-line to the START and data-source-end-line to the END of a multi-line block", async () => {
    // A fenced code block spans several source lines, so start.line !== end.line.
    // This distinguishes the two attributes (single-line blocks can't): the
    // opening fence is line 1 and the closing fence is line 4. Guards against a
    // start/end swap in the source-position transform, which single-line
    // fixtures cannot detect.
    const md = "```ts\nconst x = 1;\nconst y = 2;\n```\n";
    const html = await renderMarkdown(md);
    const preTag = /<pre\b[^>]*>/.exec(html)?.[0] ?? "";
    expect(preTag).toMatch(/data-source-line="1"/);
    expect(preTag).toMatch(/data-source-end-line="4"/);
    // Explicitly assert start < end so a swap (4 vs 1) fails.
    const start = Number(/data-source-line="(\d+)"/.exec(preTag)?.[1]);
    const end = Number(/data-source-end-line="(\d+)"/.exec(preTag)?.[1]);
    expect(start).toBeLessThan(end);
  });
});

describe("renderMarkdown — collapsible sections & slugs", () => {
  it("wraps each heading in a section carrying a slugified data-section-id + level", async () => {
    const html = await renderMarkdown("# Hello World\n\nBody.\n");
    expect(html).toMatch(
      /<section\b[^>]*class="emr-section emr-section-level-1 emr-section--doc-title"[^>]*data-section-id="hello-world"[^>]*data-section-level="1"/,
    );
    // The heading keeps a matching id for DocNav / anchor jumps.
    expect(html).toMatch(/<h1\b[^>]*id="hello-world"/);
  });

  it("strips punctuation and collapses separators when slugging (kills slugify regex mutants)", async () => {
    const html = await renderMarkdown("## Foo, Bar_Baz -- Qux!\n");
    // `,` and `!` dropped; spaces / underscores / dashes collapse to one dash.
    expect(html).toMatch(/data-section-id="foo-bar-baz-qux"/);
  });

  it("falls back to the literal slug 'section' when a heading has no slug chars", async () => {
    const html = await renderMarkdown("### !!! ???\n");
    expect(html).toMatch(/data-section-id="section"/);
  });

  it("disambiguates duplicate heading slugs with a numeric suffix", async () => {
    // Two identical headings: first stays `dup`, the second becomes `dup-2`.
    // Kills the `n === 1 ? base : base-n` counter mutants in mintId.
    const html = await renderMarkdown("# Dup\n\n# Dup\n");
    expect(html).toMatch(/data-section-id="dup"/);
    expect(html).toMatch(/data-section-id="dup-2"/);
    expect(html).not.toMatch(/data-section-id="dup-1"/);
  });

  it("nests a deeper heading inside its parent section", async () => {
    const html = await renderMarkdown("# Parent\n\n## Child\n\nText.\n");
    // The child <section level 2> appears inside the parent <section level 1>,
    // before the parent section closes.
    const parentOpen = html.indexOf('data-section-level="1"');
    const childOpen = html.indexOf('data-section-level="2"');
    expect(parentOpen).toBeGreaterThanOrEqual(0);
    expect(childOpen).toBeGreaterThan(parentOpen);
    // There is exactly one closing </section> after the child, i.e. the child
    // is enclosed — the parent section wraps both.
    const level1Count = (html.match(/emr-section-level-1/g) ?? []).length;
    const level2Count = (html.match(/emr-section-level-2/g) ?? []).length;
    expect(level1Count).toBe(1);
    expect(level2Count).toBe(1);
  });

  it("does NOT nest a same-level sibling heading (kills the `<= level` boundary mutant)", async () => {
    // Two H2s at the same level must produce two SIBLING sections, not one
    // nested inside the other. If the break condition were `< level` instead
    // of `<= level`, the second H2 would be swallowed into the first section.
    const html = await renderMarkdown("## First\n\nA\n\n## Second\n\nB\n");
    const first = html.indexOf('data-section-id="first"');
    const second = html.indexOf('data-section-id="second"');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
    // A </section> must close "first" before "second" opens (siblings).
    const between = html.slice(first, second);
    expect(between).toContain("</section>");
  });

  it("marks the single outermost section as the document title", async () => {
    // One top-level heading that wraps the whole doc → its section is the
    // title and carries `emr-section--doc-title` (the UI drops its chevron).
    const html = await renderMarkdown("# Title\n\nBody.\n\n## Sub\n\nMore.\n");
    expect(html).toMatch(
      /class="emr-section emr-section-level-1 emr-section--doc-title"/,
    );
    // The nested subsection is NOT a title.
    const subMatch = html.match(
      /<section[^>]*data-section-id="sub"[^>]*class="([^"]*)"|<section[^>]*class="([^"]*)"[^>]*data-section-id="sub"/,
    );
    expect(html).not.toMatch(/emr-section-level-2[^"]*emr-section--doc-title/);
    expect(subMatch).not.toBeNull();
  });

  it("marks no title when the document has multiple top-level headings", async () => {
    const html = await renderMarkdown("# One\n\nA\n\n# Two\n\nB\n");
    expect(html).not.toContain("emr-section--doc-title");
  });

  it("marks no title when content precedes the first heading", async () => {
    const html = await renderMarkdown(
      "Intro paragraph.\n\n# Heading\n\nBody.\n",
    );
    expect(html).not.toContain("emr-section--doc-title");
  });

  it("marks no title when the document has no heading at all", async () => {
    const html = await renderMarkdown("Just a paragraph, no headings.\n");
    expect(html).not.toContain("emr-section--doc-title");
  });
});

describe("renderMarkdown — mention pills", () => {
  it("renders a user mention as a display-only span with no href", async () => {
    const html = await renderMarkdown("Hi [@Ann](mention://user/ann)\n");
    expect(html).toMatch(
      /<span\b[^>]*class="emr-mention emr-mention-user"[^>]*data-mention-kind="user"[^>]*data-mention-id="ann"/,
    );
    expect(html).not.toContain('href="mention://user/ann"');
  });

  it("keeps a work-item mention as a link and injects a state dot", async () => {
    const html = await renderMarkdown("See [#42](mention://workitem/42)\n");
    expect(html).toMatch(/<a\b[^>]*href="mention:\/\/workitem\/42"/);
    expect(html).toMatch(/<a\b[^>]*class="emr-mention emr-mention-workitem"/);
    expect(html).toMatch(/<a\b[^>]*data-mention-kind="workitem"/);
    expect(html).toContain("emr-mention-state-dot");
    expect(html).toMatch(/target="_blank"/);
  });

  it("leaves ordinary links untouched", async () => {
    const html = await renderMarkdown("[docs](https://example.com/x)\n");
    expect(html).toMatch(/<a\b[^>]*href="https:\/\/example.com\/x"/);
    expect(html).not.toContain("emr-mention");
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
    expect(html).toContain('<dt class="emr-frontmatter-key">title</dt>');
    expect(html).toContain(
      '<dd class="emr-frontmatter-value">Release Notes</dd>',
    );
    expect(html).toContain('<dt class="emr-frontmatter-key">author</dt>');
    expect(html).toContain(
      '<dd class="emr-frontmatter-value">Ada Lovelace</dd>',
    );

    // The card comes first, then the rendered heading.
    expect(html.indexOf("emr-frontmatter")).toBeLessThan(html.indexOf("<h1"));
    // The raw `---` fence and key/value lines never leak into the prose.
    expect(html).not.toContain("<hr");
    expect(html).not.toContain("title: Release Notes");
  });

  it("preserves body source line numbers after stripping frontmatter", async () => {
    // `# Heading` sits on source line 6; anchoring must still report line 6.
    const md = [
      "---",
      "title: Doc",
      "tags: [a, b]",
      "---",
      "",
      "# Heading",
      "",
    ].join("\n");
    const html = await renderMarkdown(md);
    expect(html).toMatch(/<h1\b[^>]*data-source-line="6"/);
  });

  it("stamps the metadata card with the frontmatter source line span", async () => {
    // The block occupies source lines 1-4 (open fence, two entries, close).
    const md = [
      "---",
      "title: Doc",
      "author: Ann",
      "---",
      "",
      "# Heading",
      "",
    ].join("\n");
    const html = await renderMarkdown(md);
    const card = /<div class="emr-frontmatter"[^>]*>/.exec(html)?.[0] ?? "";
    expect(card).toMatch(/data-source-line="1"/);
    expect(card).toMatch(/data-source-end-line="4"/);
  });

  it("stamps each key row with its own source line for granular diffing", async () => {
    // title -> source line 2, author -> source line 3.
    const md = [
      "---",
      "title: Doc",
      "author: Ann",
      "---",
      "",
      "Body.",
      "",
    ].join("\n");
    const html = await renderMarkdown(md);
    const rows = [
      ...html.matchAll(/<div class="emr-frontmatter-row"[^>]*>/g),
    ].map((m) => m[0]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(
      /data-source-line="2"[^>]*data-source-end-line="2"/,
    );
    expect(rows[1]).toMatch(
      /data-source-line="3"[^>]*data-source-end-line="3"/,
    );
  });

  it("spans a block-list row from its key line to its last item line", async () => {
    // reviewers key on line 2, items on lines 3 and 4 -> row spans 2..4.
    const md = [
      "---",
      "reviewers:",
      "  - Ann",
      "  - Bob",
      "---",
      "",
      "Body.",
      "",
    ].join("\n");
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
    expect(html).toContain(
      '<dd class="emr-frontmatter-value">alpha, beta</dd>',
    );
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
    expect(html).toContain(
      '<dd class="emr-frontmatter-value">Quoted Title</dd>',
    );
    expect(html).toContain(
      '<dd class="emr-frontmatter-value">Ada Lovelace</dd>',
    );
  });

  it("escapes HTML in frontmatter values (XSS-safe)", async () => {
    const md = [
      "---",
      "title: <img src=x onerror=alert(1)>",
      "---",
      "",
      "Body.",
      "",
    ].join("\n");
    const html = await renderMarkdown(md);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&#x3C;img");
  });

  it("does not treat a mid-document '---' as frontmatter", async () => {
    const md = ["# Heading", "", "---", "", "More text.", ""].join("\n");
    const html = await renderMarkdown(md);
    expect(html).not.toContain("emr-frontmatter");
    // A thematic break in the body stays a real <hr>.
    expect(html).toContain("<hr");
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
    const md = ["---", "  - orphan", "title: Doc", "---", "", "Body.", ""].join(
      "\n",
    );
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
    expect(frontmatterValuesForKey("tags: [a, b, c]", "tags")).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("returns block-list values for a matching key", () => {
    const src = ["reviewers:", "  - Ann", "  - Bob"].join("\n");
    expect(frontmatterValuesForKey(src, "reviewers")).toEqual(["Ann", "Bob"]);
  });

  it("returns a single-element list for a scalar key", () => {
    expect(frontmatterValuesForKey("status: Draft", "status")).toEqual([
      "Draft",
    ]);
  });

  it("returns null when the key is absent", () => {
    expect(frontmatterValuesForKey("title: Doc", "tags")).toBeNull();
  });

  it("ignores a `#`-comment line even when it contains a colon", () => {
    // The blank/comment skip must fire before key parsing, so `# note: x`
    // never becomes a key of its own.
    expect(
      frontmatterValuesForKey("title: Doc\n# note: x", "# note"),
    ).toBeNull();
    expect(frontmatterValuesForKey("title: Doc\n# note: x", "title")).toEqual([
      "Doc",
    ]);
  });

  it("treats an unclosed `[` value as a scalar, not an inline list", () => {
    // Needs BOTH the `[` prefix AND the `]` suffix to parse as a flow list.
    expect(frontmatterValuesForKey("k: [broken", "k")).toEqual(["[broken"]);
  });

  it("drops empty items from an inline list", () => {
    expect(frontmatterValuesForKey("k: [a, , b]", "k")).toEqual(["a", "b"]);
  });

  it("unquotes a two-character quoted value", () => {
    // Boundary for the `value.length >= 2` guard in `unquote`.
    expect(frontmatterValuesForKey('k: ""', "k")).toEqual([""]);
  });
});

describe("parseFrontmatterListItems", () => {
  it("parses bare `- item` lines, unquoting and skipping blanks", () => {
    const fragment = ["  - Ada Lovelace", '  - "Grace Hopper"', "  - "].join(
      "\n",
    );
    expect(parseFrontmatterListItems(fragment)).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
    ]);
  });

  it("returns an empty array when there are no item lines", () => {
    expect(parseFrontmatterListItems("status: Draft")).toEqual([]);
  });
});

describe("sanitizeCssColor", () => {
  it.each([
    ["#abc", "#abc"],
    ["ABC", "#abc"],
    ["#AABBCC", "#aabbcc"],
    ["#11223344", "#11223344"],
    ["#abcd", "#abcd"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(sanitizeCssColor(input)).toBe(expected);
  });

  it.each([
    ["red"],
    ["#12"],
    ["#12345"],
    ["#1234567"],
    ["#gggggg"],
    ["rgb(0,0,0)"],
    [""],
  ])("rejects %s", (input) => {
    expect(sanitizeCssColor(input)).toBeNull();
  });
});
