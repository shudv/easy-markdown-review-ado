// Azure DevOps wiki macros through the real render pipeline: `[[_TOC_]]` and
// `[[_TOSP_]]`.

import { describe, expect, it } from "vitest";

import { renderMarkdown, renderMarkdownSync } from "../src/markdown/render";
import { resolveDocLink } from "../src/markdown/docLinks";
import {
  fillSubpagesMacros,
  hasSubpagesMacro,
} from "../src/markdown/wikiMacros";

function parse(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

/** The TOC as nested `[text, href, children]` tuples, for readable asserts. */
type TocNode = [string, string, TocNode[]];
function tocTree(list: Element | null): TocNode[] {
  if (!list) return [];
  return Array.from(list.children).map((li) => {
    const a = li.querySelector(":scope > a")!;
    const nested = Array.from(li.querySelectorAll(":scope > ul")).flatMap(
      (ul) => tocTree(ul),
    );
    return [a.textContent, a.getAttribute("href")!, nested];
  });
}

describe("[[_TOC_]]", () => {
  it("renders a nested table of contents linking to heading ids", () => {
    const root = parse(
      renderMarkdownSync(
        [
          "# Design",
          "",
          "[[_TOC_]]",
          "",
          "## Goals",
          "### Non-goals",
          "## Rollout & risks",
          "# Appendix",
        ].join("\n"),
      ),
    );
    const nav = root.querySelector("nav.emr-wiki-macro.emr-wiki-toc")!;
    expect(nav.getAttribute("aria-label")).toBe("Contents");
    expect(nav.getAttribute("data-wiki-macro")).toBe("toc");
    expect(nav.querySelector(".emr-wiki-macro-title")!.textContent).toBe(
      "Contents",
    );
    expect(tocTree(nav.querySelector(":scope > ul"))).toEqual([
      [
        "Design",
        "#design",
        [
          ["Goals", "#goals", [["Non-goals", "#non-goals", []]]],
          ["Rollout & risks", "#rollout-risks", []],
        ],
      ],
      ["Appendix", "#appendix", []],
    ]);
    // Every link target exists in the rendered document.
    for (const a of nav.querySelectorAll("a")) {
      expect(root.querySelector(a.getAttribute("href")!)).not.toBeNull();
    }
  });

  it("keeps the macro's source line for diffs and line anchors", () => {
    const root = parse(renderMarkdownSync("# T\n\n[[_TOC_]]\n"));
    const nav = root.querySelector("nav")!;
    expect(nav.getAttribute("data-source-line")).toBe("3");
    // Generated entries carry no source lines of their own.
    expect(nav.querySelector("li[data-source-line]")).toBeNull();
  });

  it("returns to the matching list after a deeper run", () => {
    const root = parse(
      renderMarkdownSync("[[_TOC_]]\n\n## A\n#### Deep\n### B\n## C\n"),
    );
    expect(tocTree(root.querySelector("nav > ul"))).toEqual([
      [
        "A",
        "#a",
        [
          ["Deep", "#deep", []],
          ["B", "#b", []],
        ],
      ],
      ["C", "#c", []],
    ]);
  });

  it("starts a new top level when a later heading is shallower than the first", () => {
    const root = parse(renderMarkdownSync("[[_TOC_]]\n\n## Intro\n# Main\n"));
    expect(tocTree(root.querySelector("nav > ul"))).toEqual([
      ["Intro", "#intro", []],
      ["Main", "#main", []],
    ]);
  });

  it("says so when the page has no headings", () => {
    const root = parse(renderMarkdownSync("[[_TOC_]]\n\nJust prose."));
    expect(root.querySelector("nav ul")).toBeNull();
    expect(root.querySelector(".emr-wiki-macro-note")!.textContent).toBe(
      "This page has no headings.",
    );
  });

  it("renders every macro on the page from one heading scan", () => {
    const root = parse(renderMarkdownSync("[[_TOC_]]\n\n# A\n\n[[_TOC_]]\n"));
    expect(root.querySelectorAll("nav.emr-wiki-toc")).toHaveLength(2);
  });

  it.each([
    "[[_toc_]]",
    "See [[_TOC_]] below",
    "`[[_TOC_]]`",
    "[[_TOC_]] [[_TOC_]]",
  ])("leaves non-macro text alone: %j", (md) => {
    const root = parse(renderMarkdownSync(md));
    expect(root.querySelector("nav")).toBeNull();
  });

  it.each(["constructor", "toString", "hasOwnProperty", "valueOf"])(
    "keeps a paragraph named like an object property: %j",
    (md) => {
      const root = parse(renderMarkdownSync(md));
      expect(root.querySelector("nav")).toBeNull();
      expect(root.querySelector("p")!.textContent).toBe(md);
    },
  );

  it("tolerates surrounding whitespace on the macro line", () => {
    const root = parse(renderMarkdownSync("  [[_TOC_]]  \n\n# A\n"));
    expect(root.querySelector("nav.emr-wiki-toc")).not.toBeNull();
  });
});

describe("[[_TOSP_]]", () => {
  const subpagesBox = (html: string) =>
    parse(html).querySelector("nav.emr-wiki-macro.emr-wiki-tosp")!;

  it("renders a subpages box that says subpages aren't available yet", () => {
    const nav = subpagesBox(renderMarkdownSync("# Guides\n\n[[_TOSP_]]\n"));
    expect(nav.getAttribute("aria-label")).toBe("Subpages");
    expect(nav.getAttribute("data-source-line")).toBe("3");
    expect(nav.textContent).toBe("SubpagesSubpages aren't available here.");
  });

  it("fills in the subpages a host listed, in order", async () => {
    const html = fillSubpagesMacros(
      await renderMarkdown("# Guides\n\n[[_TOSP_]]\n"),
      [
        { path: "/Guides/Getting-started.md", title: "Getting started" },
        { path: "/Guides/FAQ%3A0525.md", title: "FAQ:0525" },
        { path: "/Guides/C#-notes?.md", title: "C# notes?" },
      ],
    );
    const nav = subpagesBox(html);
    // The title and the box's source position survive the fill.
    expect(nav.querySelector(".emr-wiki-macro-title")!.textContent).toBe(
      "Subpages",
    );
    expect(nav.getAttribute("data-source-line")).toBe("3");
    const links = Array.from(nav.querySelectorAll("li > a"));
    expect(links.map((a) => a.textContent)).toEqual([
      "Getting started",
      "FAQ:0525",
      "C# notes?",
    ]);
    // Each path segment is URL-encoded, so a literal `%`, `#` or `?` in a wiki
    // file name stays part of the path.
    const hrefs = links.map((a) => a.getAttribute("href")!);
    expect(hrefs).toEqual([
      "/Guides/Getting-started.md",
      "/Guides/FAQ%253A0525.md",
      "/Guides/C%23-notes%3F.md",
    ]);
    expect(resolveDocLink("/Guides.md", hrefs[2]!)).toEqual({
      kind: "repo-file",
      path: "/Guides/C#-notes?.md",
      hash: "",
      isMarkdown: true,
    });
  });

  it.each([
    ["loading", "Loading subpages…"],
    ["unavailable", "Subpages aren't available here."],
    [[], "This page has no subpages."],
  ] as const)("shows the %j state as a note", (state, note) => {
    const html = fillSubpagesMacros(renderMarkdownSync("[[_TOSP_]]"), state);
    expect(subpagesBox(html).querySelector("ul")).toBeNull();
    expect(
      subpagesBox(html).querySelector(".emr-wiki-macro-note")!.textContent,
    ).toBe(note);
  });

  it("fills every subpages box and leaves other HTML untouched", () => {
    const html = fillSubpagesMacros(
      renderMarkdownSync("[[_TOSP_]]\n\nBetween <b>us</b>.\n\n[[_TOSP_]]\n"),
      "loading",
    );
    const root = parse(html);
    expect(root.querySelectorAll(".emr-wiki-macro-note")).toHaveLength(2);
    expect(root.querySelector("p:not([class])")!.textContent).toBe(
      "Between us.",
    );
  });

  it("returns HTML without a subpages box as is", () => {
    const html = renderMarkdownSync("# Title\n\n[[_TOC_]]\n");
    expect(fillSubpagesMacros(html, [])).toBe(html);
  });
});

describe("hasSubpagesMacro", () => {
  it.each([
    ["[[_TOSP_]]", true],
    ["# Title\n\n  [[_TOSP_]]  \n", true],
    ["> [[_TOSP_]]", true],
    ["[[_TOC_]]", false],
    ["inline [[_TOSP_]] text", false],
    ["[[_tosp_]]", false],
    ["```\n[[_TOSP_]]\n```", false],
    ["    [[_TOSP_]]", false],
  ])("matches the rendered macro for %j → %s", (source, expected) => {
    expect(hasSubpagesMacro(renderMarkdownSync(source))).toBe(expected);
  });
});
