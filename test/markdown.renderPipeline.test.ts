// Behavioural tests for the rich-rendering features of the markdown pipeline:
// inline mention pills and collapsible heading sections, plus the synchronous
// render entry point. We assert on the rendered HTML contract (the classes,
// attributes and structure other modules and the stylesheet depend on),
// driving everything through public markdown source rather than internals.

import { describe, it, expect } from "vitest";
import { renderMarkdown, renderMarkdownSync } from "../src/markdown/render";

describe("renderMarkdown — mention pills", () => {
  it("renders a user mention as a non-navigable span with no href", async () => {
    const html = await renderMarkdown("Hi [@alice](mention://user/alice)");
    expect(html).toMatch(
      /<span[^>]*class="[^"]*emr-mention emr-mention-user[^"]*"/,
    );
    expect(html).toContain('data-mention-kind="user"');
    expect(html).toContain('data-mention-id="alice"');
    // User mentions must not be links.
    expect(html).not.toMatch(/<a[^>]*mention:\/\/user/);
  });

  it("converts a native ADO `@<GUID>` token into a user-mention pill", async () => {
    const guid = "6b71186c-c2e6-6813-b4e0-ffcd511163f4";
    const html = await renderMarkdown(`Please review @<${guid}> thanks`);
    // The token flows through preprocessUserMentions → rehypeMentions and lands
    // as a hydratable user pill carrying the GUID (name filled at hydration).
    expect(html).toMatch(
      /<span[^>]*class="[^"]*emr-mention emr-mention-user[^"]*"/,
    );
    expect(html).toContain(`data-mention-id="${guid}"`);
    // The raw `<GUID>` must NOT survive as dropped/broken HTML.
    expect(html).not.toContain(`&#x3C;${guid}`);
    expect(html).not.toContain(`<${guid}`);
  });

  it("keeps a work-item mention as a new-tab link with a leading state dot", async () => {
    const html = await renderMarkdown(
      "See [#42](mention://workitem/42?stateColor=00ff00)",
    );
    expect(html).toMatch(
      /<a[^>]*class="[^"]*emr-mention emr-mention-workitem[^"]*"/,
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('data-mention-param-state-color="00ff00"');
    // A status dot is injected as the first child, coloured from stateColor.
    expect(html).toMatch(
      /<span[^>]*class="emr-mention-state-dot"[^>]*style="background:#?00ff00"/,
    );
  });

  it("adds a PR-status class to the dot of a pull-request mention", async () => {
    const html = await renderMarkdown(
      "PR [!9](mention://pullrequest/9?status=active)",
    );
    expect(html).toMatch(
      /<span[^>]*class="emr-mention-state-dot emr-pr-state-active"/,
    );
  });

  it("renders a bare state dot for a pull-request mention with no status", async () => {
    // Without a `status` param the dot still renders, but carries no
    // `emr-pr-state-*` modifier class.
    const html = await renderMarkdown("PR [!9](mention://pullrequest/9)");
    expect(html).toMatch(/<span[^>]*class="emr-mention-state-dot"/);
    expect(html).not.toMatch(/emr-pr-state-/);
  });

  it("emits no inline style at all for a state color that isn't valid hex", async () => {
    const html = await renderMarkdown(
      'WI [#1](mention://workitem/1?stateColor=red";<script>)',
    );
    // `sanitizeCssColor` allow-lists hex shapes and fails closed, so a hostile
    // value produces NO `style` attribute on the dot — nothing to break out of.
    const dot = html.match(
      /<span[^>]*class="emr-mention-state-dot"[^>]*><\/span>/,
    );
    expect(dot).not.toBeNull();
    expect(dot![0]).not.toContain("style=");
  });

  it("leaves ordinary links untouched", async () => {
    const html = await renderMarkdown("[home](https://example.com)");
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain("emr-mention");
  });
});

describe("renderMarkdown — collapsible sections", () => {
  it("wraps a heading and its body in a section keyed by a heading slug", async () => {
    const html = await renderMarkdown("# Hello World\n\nBody text.\n");
    expect(html).toMatch(
      /<section[^>]*class="emr-section emr-section-level-1 emr-section--doc-title"[^>]*data-section-id="hello-world"/,
    );
    // The heading keeps a matching id for deep-links / DocNav.
    expect(html).toMatch(/<h1[^>]*id="hello-world"/);
    expect(html).toContain("Body text.");
  });

  it("nests a subsection inside its parent heading's section", async () => {
    const html = await renderMarkdown("# Parent\n\n## Child\n\ntext\n");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const parent = doc.querySelector('[data-section-id="parent"]');
    const child = doc.querySelector('[data-section-id="child"]');
    expect(parent).not.toBeNull();
    expect(child).not.toBeNull();
    // True nesting: the child section is a DOM descendant of the parent,
    // not merely a later sibling.
    expect(parent).not.toBe(child);
    expect(parent!.contains(child!)).toBe(true);
    expect(child!.classList.contains("emr-section-level-2")).toBe(true);
  });

  it("disambiguates duplicate heading slugs with a numeric suffix", async () => {
    const html = await renderMarkdown("# Notes\n\n# Notes\n");
    expect(html).toContain('data-section-id="notes"');
    expect(html).toContain('data-section-id="notes-2"');
  });

  it("falls back to a stable id when a heading has no slug-able text", async () => {
    // A heading of only punctuation slugs to empty → the `"section"` fallback.
    const html = await renderMarkdown("# ...\n");
    expect(html).toContain('data-section-id="section"');
  });

  it("does not overwrite a heading id that already exists", async () => {
    // Markdown can't set an id directly, but two identical headings exercise
    // the mint/uniqueness path; the first keeps the bare slug.
    const html = await renderMarkdown("## Setup\n\n## Setup\n");
    expect(html).toMatch(/<h2[^>]*id="setup"/);
    expect(html).toMatch(/<h2[^>]*id="setup-2"/);
  });
});

describe("renderMarkdownSync", () => {
  it("produces the same HTML as the async renderer for the same source", async () => {
    const md = "# Title\n\nA [#7](mention://workitem/7) ref.\n";
    expect(renderMarkdownSync(md)).toBe(await renderMarkdown(md));
  });

  it("renders synchronously without awaiting", () => {
    const html = renderMarkdownSync("**bold**");
    expect(html).toMatch(/<strong[^>]*>bold<\/strong>/);
  });
});

describe("renderMarkdown — emoji shortcodes", () => {
  it("converts a known shortcode to its emoji", async () => {
    const html = await renderMarkdown("Looks good :eyes:");
    expect(html).toContain("👀");
    expect(html).not.toContain(":eyes:");
  });

  it("supports symbol shortcodes like :+1: and :tada:", async () => {
    const html = await renderMarkdown(":+1: shipping this :tada:");
    expect(html).toContain("👍");
    expect(html).toContain("🎉");
  });

  it("leaves unknown shortcodes untouched", async () => {
    const html = await renderMarkdown("build :not_a_real_emoji: step");
    expect(html).toContain(":not_a_real_emoji:");
  });

  it("does not convert shortcodes inside inline code", async () => {
    const html = await renderMarkdown("use `:eyes:` literally");
    expect(html).toContain(":eyes:");
    expect(html).not.toContain("👀");
  });

  it("does not convert shortcodes inside fenced code blocks", async () => {
    const html = await renderMarkdown("```\n:rocket: launch\n```");
    expect(html).toContain(":rocket:");
    expect(html).not.toContain("🚀");
  });

  it("resolves shortcodes case-insensitively", async () => {
    const html = await renderMarkdown("nice :EYES:");
    expect(html).toContain("👀");
  });
});
