// Tests for ADO-style `:::mermaid` fences and rehype placeholder emission.
import { describe, it, expect } from "vitest";

import { preprocessMermaidBlocks } from "../src/markdown/mermaid";
import { renderMarkdown } from "../src/markdown/render";

describe("preprocessMermaidBlocks", () => {
  it("rewrites ADO colon fences to backtick fences with language=mermaid", () => {
    const src = [
      "Intro paragraph.",
      "",
      ":::mermaid",
      "flowchart LR",
      "  A --> B",
      ":::",
      "",
      "After.",
    ].join("\n");
    const out = preprocessMermaidBlocks(src);
    expect(out).toContain("```mermaid");
    expect(out).toContain("flowchart LR");
    expect(out).toContain("A --> B");
    expect(out).toContain("```");
    expect(out).not.toContain(":::mermaid");
    // No trailing `:::` after the closing backtick fence.
    expect(out.match(/:::/g)).toBeNull();
  });

  it("preserves the leading indentation of the colon fence", () => {
    const src = [
      "- item",
      "  :::mermaid",
      "  flowchart LR",
      "    A --> B",
      "  :::",
    ].join("\n");
    const out = preprocessMermaidBlocks(src);
    const lines = out.split("\n");
    expect(lines).toContain("  ```mermaid");
    expect(lines).toContain("  ```");
  });

  it("matches the trigger case-insensitively", () => {
    const src = [":::Mermaid", "graph TD", "A-->B", ":::"].join("\n");
    expect(preprocessMermaidBlocks(src)).toContain("```mermaid");
  });

  it("supports four-or-more colons on the fence", () => {
    const src = ["::::mermaid", "flowchart LR", "A --> B", "::::"].join("\n");
    expect(preprocessMermaidBlocks(src)).toContain("```mermaid");
  });

  it("leaves unterminated colon blocks untouched", () => {
    const src = [":::mermaid", "flowchart LR", "A --> B"].join("\n");
    const out = preprocessMermaidBlocks(src);
    expect(out).toBe(src);
  });

  it("is a no-op when no mermaid block is present", () => {
    const src = "# Heading\n\nParagraph.\n";
    expect(preprocessMermaidBlocks(src)).toBe(src);
  });
});

describe("renderMarkdown — mermaid placeholders", () => {
  it("emits an emr-mermaid div for an ADO colon fence", async () => {
    const md = [
      "Pipeline:",
      "",
      ":::mermaid",
      "flowchart LR",
      '  PR["PR opens"] --> Validate["validate-designs.mjs"]',
      '  Validate --> Semantic["semantic review"]',
      ":::",
    ].join("\n");
    const html = await renderMarkdown(md);
    expect(html).toContain('class="emr-mermaid"');
    expect(html).toContain("data-mermaid-src=");
    // The fallback `<pre>` carries the raw source for the non-JS case.
    expect(html).toContain("emr-mermaid-fallback");
    expect(html).toContain("flowchart LR");
    // No raw `<pre><code class="language-mermaid">` survives.
    expect(html).not.toContain("language-mermaid");
  });

  it("emits the same placeholder for a GitHub-style backtick fence", async () => {
    const md = "```mermaid\nflowchart LR\n  A --> B\n```\n";
    const html = await renderMarkdown(md);
    expect(html).toContain('class="emr-mermaid"');
    expect(html).toContain("data-mermaid-src=");
    expect(html).not.toContain("language-mermaid");
  });

  it("carries the source-line span onto the placeholder (for diffing)", async () => {
    const md =
      "# Title\n\nIntro.\n\n```mermaid\nflowchart LR\n  A --> B\n```\n";
    const html = await renderMarkdown(md);
    const div = document.createElement("div");
    div.innerHTML = html;
    const mermaid = div.querySelector<HTMLElement>(".emr-mermaid")!;
    expect(mermaid).not.toBeNull();
    // The fenced block starts at line 5; the decorator relies on these attrs.
    expect(mermaid.getAttribute("data-source-line")).toBe("5");
    expect(mermaid.getAttribute("data-source-end-line")).toBe("8");
  });

  it("URL-encodes the source so quotes / newlines survive the attribute", async () => {
    const md = [
      ":::mermaid",
      "flowchart LR",
      '  A["He said \\"hi\\""] --> B',
      ":::",
    ].join("\n");
    const html = await renderMarkdown(md);
    // Encoded newline (%0A) should appear.
    expect(html).toMatch(/data-mermaid-src="[^"]*%0A[^"]*"/);
    // The literal double-quote inside the attribute must be encoded (%22)
    // so the parser doesn't bail out of the attribute early.
    expect(html).toMatch(/data-mermaid-src="[^"]*%22[^"]*"/);
  });

  it("leaves non-mermaid code blocks alone", async () => {
    const md = "```js\nconst x = 1;\n```\n";
    const html = await renderMarkdown(md);
    expect(html).toContain("language-js");
    expect(html).not.toContain("emr-mermaid");
  });

  it("leaves an empty mermaid fence as an ordinary (un-hydrated) code block", async () => {
    // No diagram source → nothing to hydrate, so no placeholder is emitted
    // and the original code block survives untouched.
    const html = await renderMarkdown("```mermaid\n```\n");
    expect(html).not.toContain("emr-mermaid");
    expect(html).toContain("language-mermaid");
  });

  it("leaves a non-mermaid code fence untouched", async () => {
    // A fence with no language has no className list at all; the placeholder
    // plugin must skip it rather than treating it as a diagram.
    const html = await renderMarkdown("```\nplain code\n```\n");
    expect(html).not.toContain("emr-mermaid");
    expect(html).toContain("plain code");
  });
});
