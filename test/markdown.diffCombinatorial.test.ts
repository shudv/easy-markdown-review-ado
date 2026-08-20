import { describe, expect, it } from "vitest";

import {
  decorateDiffRanges,
  DIFF_CELL_INLINE_CLASS,
  DIFF_CELL_METADATA_CLASS,
  DIFF_FORMAT_CLASS,
  DIFF_INLINE_CLASS,
  DIFF_METADATA_CLASS,
  DIFF_TOOLTIP_CLASS,
} from "../src/markdown/diffDecorations";
import { renderMarkdownSync } from "../src/markdown/render";
import {
  WORD_ADDED_CLASS,
  WORD_REMOVED_CLASS,
} from "../src/markdown/wordDiffDom";

type InlineContext = "paragraph" | "table-cell";

interface RenderedCase {
  root: HTMLElement;
  target: HTMLElement;
  currentText: string;
}

function renderCase(
  context: InlineContext,
  current: string,
  original: string,
): RenderedCase {
  const root = document.createElement("div");
  root.className = "markdown-body emr-rendered";
  const source =
    context === "paragraph"
      ? current
      : ["| Value |", "| --- |", `| ${current} |`].join("\n");
  root.innerHTML = renderMarkdownSync(source);
  const target = root.querySelector<HTMLElement>(
    context === "paragraph" ? "p" : "tbody td",
  )!;
  const currentText = target.textContent ?? "";
  decorateDiffRanges(
    root,
    [
      {
        startLine: context === "paragraph" ? 1 : 3,
        endLine: context === "paragraph" ? 1 : 3,
        kind: "modified",
        originalText: context === "paragraph" ? original : `| ${original} |`,
      },
    ],
    { renderInline: renderMarkdownSync },
  );
  return { root, target, currentText };
}

function markText(root: Element, className: string): string {
  return Array.from(root.querySelectorAll(`.${className}`))
    .map((element) => element.textContent)
    .join(" ");
}

function expectPreciseAndClear(
  context: InlineContext,
  rendered: RenderedCase,
): void {
  expect(rendered.root.querySelector(".emr-diff-before-trigger")).toBeNull();
  if (context === "paragraph") {
    expect(rendered.target.classList.contains(DIFF_INLINE_CLASS)).toBe(true);
  }
  decorateDiffRanges(rendered.root, [], { renderInline: renderMarkdownSync });
  expect(rendered.root.querySelector(`.${DIFF_TOOLTIP_CLASS}`)).toBeNull();
  expect(rendered.root.querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
  expect(rendered.root.querySelector(`.${WORD_REMOVED_CLASS}`)).toBeNull();
  expect(rendered.target.textContent).toBe(rendered.currentText);
}

interface SharedInlineCase {
  name: string;
  current: string;
  original: string;
  mode: "inline" | "metadata" | "mixed";
  assert(root: HTMLElement, target: HTMLElement): void;
}

const sharedCases: SharedInlineCase[] = [
  {
    name: "word replacement",
    current: "The current guide remains available.",
    original: "The legacy guide remains available.",
    mode: "inline",
    assert: (root) => {
      expect(markText(root, WORD_REMOVED_CLASS)).toContain("legacy");
      expect(markText(root, WORD_ADDED_CLASS)).toContain("current");
    },
  },
  {
    name: "formatting added",
    current: "The **release owner** approves.",
    original: "The release owner approves.",
    mode: "inline",
    assert: (root) => {
      expect(root.querySelector(`.${DIFF_FORMAT_CLASS}`)?.textContent).toBe(
        "release owner",
      );
      expect(
        root.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)?.dataset
          .diffTooltip,
      ).toBe("Bold formatting added");
    },
  },
  {
    name: "formatting removed",
    current: "The release owner approves.",
    original: "The **release owner** approves.",
    mode: "inline",
    assert: (root) => {
      expect(
        root.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)?.dataset
          .diffTooltip,
      ).toBe("Bold formatting removed");
    },
  },
  {
    name: "formatting switched",
    current: "Use *regional rollout* now.",
    original: "Use **regional rollout** now.",
    mode: "inline",
    assert: (root) => {
      expect(
        root.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)?.dataset
          .diffTooltip,
      ).toBe("Formatting changed from bold to italic");
    },
  },
  {
    name: "link wrapping added",
    current: "Read the [guide](https://example.com/guide).",
    original: "Read the guide.",
    mode: "inline",
    assert: (root) => {
      expect(
        root.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)?.dataset
          .diffTooltip,
      ).toBe("Link added: https://example.com/guide");
    },
  },
  {
    name: "link wrapping removed",
    current: "Read the guide.",
    original: "Read the [guide](https://example.com/legacy).",
    mode: "inline",
    assert: (root) => {
      expect(
        root.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)?.dataset
          .diffTooltip,
      ).toBe("Link removed: https://example.com/legacy");
    },
  },
  {
    name: "link target changed",
    current: "Read the [guide](https://example.com/v2).",
    original: "Read the [guide](https://example.com/v1).",
    mode: "metadata",
    assert: (root) => {
      expect(root.querySelectorAll(`.${DIFF_METADATA_CLASS}`)).toHaveLength(1);
      expect(markText(root, WORD_REMOVED_CLASS)).toContain("v1");
      expect(markText(root, WORD_ADDED_CLASS)).toContain("v2");
    },
  },
  {
    name: "link hostname changed",
    current: "Read the [guide](https://support.fabrikam.test/v2).",
    original: "Read the [guide](https://docs.contoso.test/v1).",
    mode: "metadata",
    assert: (root) => {
      expect(
        root
          .querySelector(`.${DIFF_METADATA_CLASS}`)
          ?.classList.contains("is-warning"),
      ).toBe(true);
    },
  },
  {
    name: "text and link target changed",
    current: "Read the [current guide](https://example.com/v2).",
    original: "Read the [legacy guide](https://example.com/v1).",
    mode: "mixed",
    assert: (root) => {
      expect(markText(root, WORD_REMOVED_CLASS)).toContain("legacy");
      expect(markText(root, WORD_ADDED_CLASS)).toContain("current");
      expect(root.querySelector(`.${DIFF_METADATA_CLASS}`)).not.toBeNull();
    },
  },
  {
    name: "formatting and link target changed",
    current: "Read the [**guide**](https://example.com/v2).",
    original: "Read the [guide](https://example.com/v1).",
    mode: "mixed",
    assert: (root) => {
      expect(root.querySelector(`.${DIFF_FORMAT_CLASS}`)).not.toBeNull();
      expect(root.querySelector(`.${DIFF_METADATA_CLASS}`)).not.toBeNull();
    },
  },
  {
    name: "image metadata changed",
    current: "![Architecture](https://example.com/v2.png)",
    original: "![Architecture](https://example.com/v1.png)",
    mode: "metadata",
    assert: (root) => {
      expect(
        root.querySelector(`.${DIFF_METADATA_CLASS}`)?.textContent,
      ).toContain("v1.png");
    },
  },
  {
    name: "text and image metadata changed",
    current:
      "Architecture status is Current ![Architecture](https://example.com/v2.png)",
    original:
      "Architecture status is Legacy ![Architecture](https://example.com/v1.png)",
    mode: "mixed",
    assert: (root) => {
      expect(markText(root, WORD_REMOVED_CLASS)).toContain("Legacy");
      expect(markText(root, WORD_ADDED_CLASS)).toContain("Current");
      expect(root.querySelector(`.${DIFF_METADATA_CLASS}`)).not.toBeNull();
    },
  },
  {
    name: "one of multiple links changed",
    current:
      "[Changed](https://example.com/v2) and [Stable](https://example.com/stable)",
    original:
      "[Changed](https://example.com/v1) and [Stable](https://example.com/stable)",
    mode: "metadata",
    assert: (root) => {
      expect(root.querySelectorAll(`.${DIFF_METADATA_CLASS}`)).toHaveLength(1);
      expect(root.querySelectorAll("a")[1]?.getAttribute("href")).toBe(
        "https://example.com/stable",
      );
    },
  },
  {
    name: "one of multiple images changed",
    current:
      "![Changed](https://example.com/v2.png) ![Stable](https://example.com/stable.png)",
    original:
      "![Changed](https://example.com/v1.png) ![Stable](https://example.com/stable.png)",
    mode: "metadata",
    assert: (root) => {
      expect(root.querySelectorAll(`.${DIFF_METADATA_CLASS}`)).toHaveLength(1);
      expect(root.querySelectorAll("img")[1]?.getAttribute("src")).toBe(
        "https://example.com/stable.png",
      );
    },
  },
  {
    name: "text formatting and target changed together",
    current: "Read the [**current guide**](https://example.com/v2).",
    original: "Read the [legacy guide](https://example.com/v1).",
    mode: "mixed",
    assert: (root) => {
      expect(markText(root, WORD_REMOVED_CLASS)).toContain("legacy");
      expect(markText(root, WORD_ADDED_CLASS)).toContain("current");
      expect(root.querySelector(`.${DIFF_METADATA_CLASS}`)).not.toBeNull();
      expect(root.querySelector(`.${DIFF_FORMAT_CLASS}`)).toBeNull();
    },
  },
];

describe.each<InlineContext>(["paragraph", "table-cell"])(
  "shared inline semantics in %s",
  (context) => {
    for (const scenario of sharedCases) {
      it(scenario.name, () => {
        const rendered = renderCase(
          context,
          scenario.current,
          scenario.original,
        );
        scenario.assert(rendered.root, rendered.target);
        const hasInlineSignal = Array.from(
          rendered.target.querySelectorAll(
            `.${WORD_ADDED_CLASS}, .${WORD_REMOVED_CLASS}, .${DIFF_FORMAT_CLASS}`,
          ),
        ).some((element) => element.closest(`.${DIFF_METADATA_CLASS}`) == null);
        const hasMetadataSignal =
          rendered.root.querySelector(`.${DIFF_METADATA_CLASS}`) != null;
        expect(hasInlineSignal).toBe(scenario.mode !== "metadata");
        expect(hasMetadataSignal).toBe(scenario.mode !== "inline");
        if (context === "table-cell") {
          expect(
            rendered.target.classList.contains(DIFF_CELL_INLINE_CLASS),
          ).toBe(scenario.mode !== "metadata");
          expect(
            rendered.target.classList.contains(DIFF_CELL_METADATA_CLASS),
          ).toBe(scenario.mode !== "inline");
        }
        expectPreciseAndClear(context, rendered);
      });
    }
  },
);

describe("context-specific confidence policies", () => {
  it("keeps a wholesale prose rewrite comparative while a short cell stays precise", () => {
    const paragraph = renderCase(
      "paragraph",
      "Current ![Architecture](https://example.com/v2.png)",
      "Legacy ![Architecture](https://example.com/v1.png)",
    );
    expect(
      paragraph.root.querySelector(".emr-diff-before-trigger"),
    ).not.toBeNull();
    expect(paragraph.root.querySelector(`.${DIFF_METADATA_CLASS}`)).toBeNull();

    const cell = renderCase(
      "table-cell",
      "Current ![Architecture](https://example.com/v2.png)",
      "Legacy ![Architecture](https://example.com/v1.png)",
    );
    expect(markText(cell.root, WORD_REMOVED_CLASS)).toContain("Legacy");
    expect(markText(cell.root, WORD_ADDED_CLASS)).toContain("Current");
    expect(cell.root.querySelector(`.${DIFF_METADATA_CLASS}`)).not.toBeNull();
  });
});
