// Unit tests for selected-text deep links (src/shell/textFragment.ts): building
// the shortest unambiguous fragment for a selection, the URL-value round trip,
// and resolving a fragment back onto live (non-reference) document text.

import { afterEach, describe, expect, it } from "vitest";

import {
  buildTextFragment,
  findTextFragment,
  parseTextFragment,
  serializeTextFragment,
  type TextFragment,
} from "../src/shell/textFragment";
import { renderMarkdownSync } from "../src/markdown/render";
import { decorateDiffRanges } from "../src/markdown/diffDecorations";

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "markdown-body emr-rendered";
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

/** A Range over the `nth` occurrence of `text` inside `root`'s flat text. */
function rangeOf(root: HTMLElement, text: string, nth = 0): Range {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const runs: { node: Text; start: number }[] = [];
  let flat = "";
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    runs.push({ node: n as Text, start: flat.length });
    flat += (n as Text).data;
  }
  let at = -1;
  for (let i = 0; i <= nth; i++) at = flat.indexOf(text, at + 1);
  if (at < 0) throw new Error(`"${text}" not found`);
  const locate = (offset: number, isEnd: boolean) => {
    const run = runs.findLast((r) =>
      isEnd ? r.start < offset : r.start <= offset,
    )!;
    return { node: run.node, offset: offset - run.start };
  };
  const start = locate(at, false);
  const end = locate(at + text.length, true);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

/** Build a fragment for `text` and resolve it again — the full round trip. */
function roundTrip(root: HTMLElement, text: string, nth = 0): string | null {
  const fragment = buildTextFragment(root, rangeOf(root, text, nth));
  expect(fragment).not.toBeNull();
  const parsed = parseTextFragment(serializeTextFragment(fragment!));
  expect(parsed).toEqual(fragment);
  const found = findTextFragment(root, parsed!);
  return found ? found.toString() : null;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("buildTextFragment", () => {
  it("quotes a short, unique selection whole with no context", () => {
    const root = mount(`<p>The rollout gate blocks deploys today.</p>`);
    expect(buildTextFragment(root, rangeOf(root, "blocks deploys"))).toEqual({
      start: "blocks deploys",
    });
  });

  it("trims surrounding whitespace and collapses inner runs", () => {
    const root = mount(`<p>Alpha   beta\n  gamma delta</p>`);
    expect(buildTextFragment(root, rangeOf(root, " beta\n  gamma "))).toEqual({
      start: "beta gamma",
    });
  });

  it("quotes a long selection by its first and last words", () => {
    const sentence =
      "Error budgets are evaluated per region every five minutes, and a breach blocks every pending deployment until the owner signs off.";
    const root = mount(`<p>Intro. ${sentence} Outro.</p>`);
    const fragment = buildTextFragment(root, rangeOf(root, sentence))!;
    expect(fragment.end).toBeDefined();
    expect(sentence.startsWith(fragment.start)).toBe(true);
    expect(sentence.endsWith(fragment.end!)).toBe(true);
    expect(fragment.start.length + fragment.end!.length).toBeLessThan(
      sentence.length,
    );
    expect(roundTrip(root, sentence)).toBe(sentence);
  });

  it("quotes a long single word (e.g. a URL) whole", () => {
    const url = `https://example.com/${"a".repeat(120)}`;
    const root = mount(`<p>See ${url} now.</p>`);
    expect(buildTextFragment(root, rangeOf(root, url))).toEqual({ start: url });
  });

  it("adds context only when the quote alone is ambiguous", () => {
    const root = mount(
      `<p>First we deploy the service.</p><p>Later we deploy the service again.</p>`,
    );
    const fragment = buildTextFragment(
      root,
      rangeOf(root, "deploy the service", 1),
    )!;
    expect(fragment.prefix ?? fragment.suffix).toBeTruthy();
    // Resolves to the SECOND occurrence, not the first.
    const found = findTextFragment(root, fragment)!;
    expect(found.startContainer.parentElement!.textContent).toContain("Later");
  });

  it("spans inline formatting and block boundaries", () => {
    const root = mount(
      `<p>Keep <strong>bold words</strong> and <em>italics</em>.</p><ul><li>next item</li></ul>`,
    );
    expect(roundTrip(root, "bold words and italics")).toBe(
      "bold words and italics",
    );
    expect(roundTrip(root, "italics.next")).toBe("italics.next");
  });

  it("ignores removed-diff content and injected controls", () => {
    const root = mount(
      `<h2 id="goals"><button class="emr-section-toggle">x</button>Goals</h2>` +
        `<div class="emr-diff-deleted-marker"><p>shared phrase</p></div>` +
        `<p>Live shared phrase here.</p>`,
    );
    const fragment = buildTextFragment(root, rangeOf(root, "shared phrase", 1));
    // The removed copy doesn't count, so no context is needed.
    expect(fragment).toEqual({ start: "shared phrase" });
    const found = findTextFragment(root, fragment!)!;
    expect(found.startContainer.parentElement!.tagName).toBe("P");
    expect(
      found.startContainer.parentElement!.closest(".emr-diff-deleted-marker"),
    ).toBeNull();
  });

  it("returns null for a selection with no live text", () => {
    const root = mount(
      `<p>Text</p><div class="emr-diff-deleted-marker"><p>gone</p></div>`,
    );
    expect(buildTextFragment(root, rangeOf(root, "gone"))).toBeNull();
  });
});

describe("findTextFragment", () => {
  it("matches across case and whitespace differences", () => {
    const root = mount(`<p>Blocks   Deploys\nwhen budgets fall.</p>`);
    const found = findTextFragment(root, { start: "blocks deploys when" });
    expect(found?.toString()).toBe("Blocks   Deploys\nwhen");
  });

  it("honours a suffix on a start…end quote", () => {
    const root = mount(`<p>a one b end x. a two b end y.</p>`);
    expect(
      findTextFragment(root, {
        start: "a",
        end: "end",
        suffix: "x",
      })?.toString(),
    ).toBe("a one b end");
    // Without a prefix the first start wins (as in browser text fragments);
    // the builder adds one whenever that would land on the wrong span.
    expect(
      findTextFragment(root, {
        prefix: "x.",
        start: "a",
        end: "end",
        suffix: "y",
      })?.toString(),
    ).toBe("a two b end");
  });

  it("builds a self-disambiguating start…end link", () => {
    const tail = "and then the deployment finally ends here";
    const long = `Start of a long sentence that keeps going ${tail}`;
    const root = mount(`<p>${long}. Filler. ${long} again.</p>`);
    expect(roundTrip(root, long, 1)).toBe(long);
    const fragment = buildTextFragment(root, rangeOf(root, long, 1))!;
    const found = findTextFragment(root, fragment)!;
    expect(found.startOffset).toBeGreaterThan(long.length);
  });

  it("returns null when the text is gone or a prefix can't fit", () => {
    const root = mount(`<p>alpha beta</p>`);
    expect(findTextFragment(root, { start: "gamma" })).toBeNull();
    expect(
      findTextFragment(root, { prefix: "zzz", start: "alpha" }),
    ).toBeNull();
    expect(findTextFragment(root, { start: "alpha", end: "omega" })).toBeNull();
    expect(findTextFragment(root, { start: "alpha", suffix: "x" })).toBeNull();
    expect(findTextFragment(root, { start: "   " })).toBeNull();
  });
});

describe("edge cases", () => {
  it("skips an end that fails its suffix and tries the next", () => {
    const root = mount(`<p>a one b end x c end y.</p>`);
    expect(
      findTextFragment(root, {
        start: "a",
        end: "end",
        suffix: "y",
      })?.toString(),
    ).toBe("a one b end x c end");
  });

  it("keeps characters whose lower case changes length", () => {
    const root = mount(`<p>Say İstanbul twice.</p>`);
    expect(findTextFragment(root, { start: "İstanbul" })?.toString()).toBe(
      "İstanbul",
    );
  });

  it("ignores text nodes the range only touches at an edge", () => {
    const root = mount(`<p>first</p><p>second</p>`);
    const [first, second] = Array.from(root.querySelectorAll("p"));
    const range = document.createRange();
    range.setStart(first!.firstChild!, 5);
    range.setEnd(second!.firstChild!, 6);
    expect(buildTextFragment(root, range)).toEqual({ start: "second" });
  });

  it("returns null for a whitespace-only selection", () => {
    const root = mount(`<p>a   b</p>`);
    const range = document.createRange();
    range.setStart(root.querySelector("p")!.firstChild!, 1);
    range.setEnd(root.querySelector("p")!.firstChild!, 4);
    expect(buildTextFragment(root, range)).toBeNull();
  });
});

describe("serialize / parse", () => {
  const cases: TextFragment[] = [
    { start: "plain" },
    { start: "a, b", end: "c%d" },
    { prefix: "before", start: "-dash-", suffix: "after" },
    { prefix: "p", start: "s", end: "e", suffix: "x" },
  ];
  it.each(cases)("round-trips %o", (fragment) => {
    expect(parseTextFragment(serializeTextFragment(fragment))).toEqual(
      fragment,
    );
  });

  it("uses the URL text-fragment syntax", () => {
    expect(
      serializeTextFragment({
        prefix: "pre",
        start: "a,b",
        end: "end",
        suffix: "post",
      }),
    ).toBe("pre-,a%2Cb,end,-post");
  });

  it("rejects malformed values", () => {
    expect(parseTextFragment("")).toBeNull();
    expect(parseTextFragment("a,b,c")).toBeNull();
    expect(parseTextFragment("%E0%A4%A")).toBeNull();
    expect(parseTextFragment("a,")).toBeNull();
    expect(parseTextFragment("pre-,-post")).toBeNull();
  });
});

describe("with diff decorations (added + removed words)", () => {
  const ORIGINAL = [
    "# Doc",
    "",
    "The rollout gate blocks deploys when budgets fall below 20%.",
    "",
    "| Region | Owner | Budget |",
    "| --- | --- | --- |",
    "| EU | Ana | 20% |",
    "",
  ].join("\n");
  const CURRENT = [
    "# Doc",
    "",
    "The rollout gate pauses releases when budgets fall below 20%.",
    "",
    "| Region | Budget |",
    "| --- | --- |",
    "| EU | 20% |",
    "",
  ].join("\n");

  /** The live article: current Markdown, with or without the PR diff shown. */
  function article(showDiff: boolean): HTMLElement {
    const root = mount(renderMarkdownSync(CURRENT));
    if (showDiff) {
      decorateDiffRanges(
        root,
        [
          {
            startLine: 3,
            endLine: 3,
            kind: "modified",
            originalStartLine: 3,
            originalEndLine: 3,
            originalText: ORIGINAL.split("\n")[2]!,
          },
          {
            startLine: 5,
            endLine: 7,
            kind: "modified",
            originalStartLine: 5,
            originalEndLine: 7,
            originalText: ORIGINAL.split("\n").slice(4, 7).join("\n"),
          },
        ],
        {
          renderInline: renderMarkdownSync,
          originalSource: ORIGINAL,
          currentSource: CURRENT,
        },
      );
    }
    return root;
  }

  /** Range from the start of `fromText` to the end of `toText` (text nodes). */
  function spanRange(
    root: HTMLElement,
    fromText: string,
    toText: string,
  ): Range {
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode())
      nodes.push(n as Text);
    const from = nodes.find((n) => n.data.includes(fromText))!;
    const to = nodes.findLast((n) => n.data.includes(toText))!;
    const range = document.createRange();
    range.setStart(from, from.data.indexOf(fromText));
    range.setEnd(to, to.data.indexOf(toText) + toText.length);
    return range;
  }

  it("quotes only live text for a selection across removed + added words", () => {
    const root = article(true);
    // The fixture really renders both sides inline; without this the
    // live-text assertions below could pass vacuously.
    expect(root.querySelector("del.emr-word-removed")?.textContent).toContain(
      "blocks deploys",
    );
    expect(root.querySelector("ins.emr-word-added")?.textContent).toContain(
      "pauses releases",
    );
    const range = spanRange(root, "rollout", "budgets");
    expect(range.toString()).toContain("blocks deploys");
    const fragment = buildTextFragment(root, range)!;
    expect(serializeTextFragment(fragment)).not.toMatch(/blocks|deploys/);
    expect(fragment.start).toBe("rollout gate pauses releases when budgets");
  });

  it("resolves the same link whether the diff is shown or hidden", () => {
    const shown = article(true);
    const madeShown = buildTextFragment(
      shown,
      spanRange(shown, "rollout", "budgets"),
    )!;
    const hidden = article(false);
    const madeHidden = buildTextFragment(
      hidden,
      spanRange(hidden, "rollout", "budgets"),
    )!;
    // Same selection, same link, either way…
    expect(madeShown).toEqual(madeHidden);
    // …and each resolves on the other view onto exactly the live words.
    expect(findTextFragment(hidden, madeShown)?.toString()).toBe(
      "rollout gate pauses releases when budgets",
    );
    const onShown = findTextFragment(shown, madeHidden)!;
    expect(onShown.toString()).toContain("pauses releases");
    expect(onShown.toString().replace(/blocks deploys\s*/, "")).toBe(
      "rollout gate pauses releases when budgets",
    );
  });
  it("ignores a removed table cell spliced into a live row", () => {
    const root = article(true);
    const removed = Array.from(
      root.querySelectorAll(".emr-diff-cell--removed"),
    ).map((cell) => cell.textContent);
    expect(removed.join(" ")).toContain("Ana");
    const fragment = buildTextFragment(root, spanRange(root, "EU", "20%"))!;
    expect(serializeTextFragment(fragment)).not.toContain("Ana");
    expect(findTextFragment(article(false), fragment)).not.toBeNull();
  });

  it("returns null when only removed words are selected", () => {
    const root = article(true);
    const del = root.querySelector("del.emr-word-removed")!;
    const range = document.createRange();
    range.selectNodeContents(del);
    expect(buildTextFragment(root, range)).toBeNull();
  });
});
