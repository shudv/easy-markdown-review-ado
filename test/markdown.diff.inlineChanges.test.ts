import { beforeEach, describe, expect, it } from "vitest";

import {
    decorateDiffRanges,
    DIFF_CELL_INLINE_CLASS,
    DIFF_CELL_METADATA_CLASS,
    DIFF_FORMAT_CLASS,
    DIFF_INLINE_CLASS,
    DIFF_METADATA_CLASS,
    DIFF_TOOLTIP_CLASS,
} from "../src/markdown/diffDecorations";
import { applyLinkTargetIndicators } from "../src/markdown/diffDecorations/metadata";
import { renderMarkdownSync } from "../src/markdown/render";
import { WORD_ADDED_CLASS, WORD_REMOVED_CLASS } from "../src/markdown/wordDiffDom";
import { decorate, expectPreciseAmber, render, view, words } from "./markdownDiffHarness";

// Inline changes inside prose and table cells: word edits, formatting added /
// removed / switched, links wrapped or retargeted, and image metadata. The
// same edit must read the same way in a paragraph and in a table cell.

beforeEach(() => {
    document.body.innerHTML = "";
});

type InlineContext = "paragraph" | "table-cell";

interface RenderedCase {
    root: HTMLElement;
    target: HTMLElement;
    currentText: string;
}

function renderCase(context: InlineContext, current: string, original: string): RenderedCase {
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";

    const source =
        context === "paragraph" ? current : ["| Value |", "| --- |", `| ${current} |`].join("\n");

    root.innerHTML = renderMarkdownSync(source);

    const target = root.querySelector<HTMLElement>(context === "paragraph" ? "p" : "tbody td")!;

    const currentText = target.textContent;
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

function expectPreciseAndClear(context: InlineContext, rendered: RenderedCase): void {
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
            expect(root.querySelector(`.${DIFF_FORMAT_CLASS}`)?.textContent).toBe("release owner");
            expect(
                root.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)?.dataset.diffTooltip,
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
                root.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)?.dataset.diffTooltip,
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
                root.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)?.dataset.diffTooltip,
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
                root.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)?.dataset.diffTooltip,
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
                root.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)?.dataset.diffTooltip,
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
                root.querySelector(`.${DIFF_METADATA_CLASS}`)?.classList.contains("is-warning"),
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
            expect(root.querySelector(`.${DIFF_METADATA_CLASS}`)?.textContent).toContain("v1.png");
        },
    },
    {
        name: "text and image metadata changed",
        current: "Architecture status is Current ![Architecture](https://example.com/v2.png)",
        original: "Architecture status is Legacy ![Architecture](https://example.com/v1.png)",
        mode: "mixed",
        assert: (root) => {
            expect(markText(root, WORD_REMOVED_CLASS)).toContain("Legacy");
            expect(markText(root, WORD_ADDED_CLASS)).toContain("Current");
            expect(root.querySelector(`.${DIFF_METADATA_CLASS}`)).not.toBeNull();
        },
    },
    {
        name: "one of multiple links changed",
        current: "[Changed](https://example.com/v2) and [Stable](https://example.com/stable)",
        original: "[Changed](https://example.com/v1) and [Stable](https://example.com/stable)",
        mode: "metadata",
        assert: (root) => {
            expect(root.querySelectorAll(`.${DIFF_METADATA_CLASS}`)).toHaveLength(1);
            expect(root.querySelectorAll("a")[1]!.getAttribute("href")).toBe(
                "https://example.com/stable",
            );
        },
    },
    {
        name: "one of multiple images changed",
        current: "![Changed](https://example.com/v2.png) ![Stable](https://example.com/stable.png)",
        original:
            "![Changed](https://example.com/v1.png) ![Stable](https://example.com/stable.png)",
        mode: "metadata",
        assert: (root) => {
            expect(root.querySelectorAll(`.${DIFF_METADATA_CLASS}`)).toHaveLength(1);
            expect(root.querySelectorAll("img")[1]!.getAttribute("src")).toBe(
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
    "the same inline edit in a %s",
    (context) => {
        it.each(sharedCases)("$name", (scenario) => {
            const rendered = renderCase(context, scenario.current, scenario.original);

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
            // Cell classes only ever apply to table cells; a paragraph never has them.
            const isCell = context === "table-cell";
            expect(rendered.target.classList.contains(DIFF_CELL_INLINE_CLASS)).toBe(
                isCell && scenario.mode !== "metadata",
            );
            expect(rendered.target.classList.contains(DIFF_CELL_METADATA_CLASS)).toBe(
                isCell && scenario.mode !== "inline",
            );
            expectPreciseAndClear(context, rendered);
        });
    },
);

describe("confidence depends on the context", () => {
    it("keeps a wholesale prose rewrite comparative while a short cell stays precise", () => {
        const paragraph = renderCase(
            "paragraph",
            "Current ![Architecture](https://example.com/v2.png)",
            "Legacy ![Architecture](https://example.com/v1.png)",
        );

        expect(paragraph.root.querySelector(".emr-diff-before-trigger")).not.toBeNull();
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

describe("inline changes end to end", () => {
    it.each([
        {
            name: "edited inline code",
            original: "Call `foo()` to start.",
            current: "Call `bar()` to start.",
            expected: "p modified inline: Call [-foo-]{+bar+}() to start.",
        },
        {
            name: "edited link text",
            original: "See [the docs](https://a.com) now.",
            current: "See [the guide](https://a.com) now.",
            expected: "p modified inline: See the [-docs-]{+guide+} now.",
        },
        {
            name: "a link moved to another host",
            original: "See [the docs](https://a.com/x) now.",
            current: "See [the docs](https://b.com/y) now.",
            expected: "p modified inline: See the docs ⟨Show link hostname change⟩ now.",
        },
        {
            name: "added bold",
            original: "This is important.",
            current: "This is **important**.",
            expected: "p modified inline: This is ⟨Bold formatting added⟩important.",
        },
        {
            name: "removed italics",
            original: "This is *very* nice.",
            current: "This is very nice.",
            expected: "p modified inline: This is ⟨Italic formatting removed⟩very nice.",
        },
        {
            name: "edited inline math",
            original: "Value $x^2$ here.",
            current: "Value $x^3$ here.",
            expected: "p modified inline: Value x^[-2-]{+3+} here.",
        },
    ])("shows $name", ({ original, current, expected }) => {
        expect(view(original, current)).toEqual([expected]);
    });
});

describe("formatting changes", () => {
    it("explains newly bold text with an accessible amber callout and no word marks", () => {
        const root = render("This is **bold** now.");

        const res = decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "This is bold now.",
            },
        ]);

        expect(res.decorated).toBe(1);
        expect(res.inlined).toBe(1);
        expect(root.querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
        expect(root.querySelector(`.${WORD_REMOVED_CLASS}`)).toBeNull();

        const paragraph = root.querySelector<HTMLElement>("p.emr-diff-block--modified")!;

        expect(paragraph.classList.contains(DIFF_INLINE_CLASS)).toBe(true);
        expect(paragraph.querySelector(`.${DIFF_METADATA_CLASS}`)).toBeNull();
        const mark = paragraph.querySelector(`.${DIFF_FORMAT_CLASS}`)!;
        expect(mark.textContent).toBe("bold");
        expect(mark.parentElement?.tagName).toBe("STRONG");
        expectPreciseAmber(mark as HTMLElement, "Bold formatting added");
    });

    it("marks text switched from bold to italic with one explanation", () => {
        const root = render("Use *regional rollout* for this release.");
        decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "Use **regional rollout** for this release.",
            },
        ]);
        const marks = root.querySelectorAll(`.${DIFF_FORMAT_CLASS}`);
        expect(marks).toHaveLength(1);
        expect(marks[0]!.textContent).toBe("regional rollout");
        expect(marks[0]!.parentElement?.tagName).toBe("EM");
        expectPreciseAmber(marks[0] as HTMLElement, "Formatting changed from bold to italic");
    });

    it("explains separate formatting changes one by one and removes them when hidden", () => {
        const root = render("**Alpha** remains separate from `beta`.");
        decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "Alpha remains separate from beta.",
            },
        ]);

        const marks = Array.from(root.querySelectorAll<HTMLElement>(`.${DIFF_FORMAT_CLASS}`));

        expect(marks.map((mark) => mark.textContent)).toEqual(["Alpha", "beta"]);
        expect(marks.map((mark) => mark.dataset.diffTooltip)).toEqual([
            "Bold formatting added",
            "Inline code formatting added",
        ]);
        decorate(root, []);
        expect(root.querySelector(`.${DIFF_FORMAT_CLASS}`)).toBeNull();
        expect(root.querySelector("strong")?.textContent).toBe("Alpha");
        expect(root.querySelector("code")?.textContent).toBe("beta");
    });

    it("finds a formatting change in a paragraph that also holds an HTML comment", () => {
        const root = render("Keep **bold** text.");
        const paragraph = root.querySelector<HTMLElement>("p")!;
        paragraph.prepend(document.createComment("reviewer note"));
        decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "Keep bold text.",
            },
        ]);

        const mark = paragraph.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)!;

        expect(mark.textContent).toBe("bold");
    });

    it.each([
        {
            name: "describes nested formatting and link wrapping together",
            current: "Read the [**deployment guide**](https://example.com/deploy).",
            original: "Read the deployment guide.",
            label: "Bold and link to https://example.com/deploy formatting added",
        },
        {
            name: "describes an equal-text quote-to-paragraph transition",
            current: "Definition",
            original: "> Definition",
            label: "Block changed from quote to paragraph",
        },
    ])("$name", ({ current, original, label }) => {
        const root = render(current);
        decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: original,
            },
        ]);
        const mark = root.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`);
        expect(mark).not.toBeNull();
        expectPreciseAmber(mark!, label);
    });
});

describe("link changes", () => {
    it("warns when a prose link moves to a different host", () => {
        const root = render("Open the [support guide](https://support.fabrikam.test/guide).");

        decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "Open the [support guide](https://docs.contoso.test/guide).",
            },
        ]);

        const indicator = root.querySelector<HTMLElement>(`.${DIFF_METADATA_CLASS}`)!;

        expect(indicator.classList.contains("is-warning")).toBe(true);
        expect(indicator.querySelector("button")?.getAttribute("aria-label")).toBe(
            "Show link hostname change",
        );
        expect(indicator.querySelector("button")?.textContent).toBe("");
    });

    it("warns when a link's previous target was an unsafe URL", () => {
        const root = render("Open the [guide](https://docs.contoso.test/guide).");

        decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "Open the [guide](javascript:alert(1)).",
            },
        ]);

        const indicator = root.querySelector<HTMLElement>(`.${DIFF_METADATA_CLASS}`)!;

        expect(indicator.classList.contains("is-warning")).toBe(true);
        expect(indicator.querySelector(".emr-diff-metadata-target-diff")?.textContent).toContain(
            "https://docs.contoso.test/guide",
        );
    });

    it("warns when a link's previous target had a malformed host", () => {
        const root = render("Open the [guide](https://docs.contoso.test/guide).");

        decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "Open the [guide](http://[broken/guide).",
            },
        ]);

        const indicator = root.querySelector<HTMLElement>(`.${DIFF_METADATA_CLASS}`)!;

        expect(indicator.classList.contains("is-warning")).toBe(true);
    });
    it("shows a link moved to another host together with prose added after it", () => {
        const linkLabel = "`docs/ReviewGuide/README.md`";

        const current =
            `The authoritative directory layout and file conventions are documented in [${linkLabel}]` +
            "(https://example.visualstudio.com/Example%20Project/_git/SharedDocs?path=/docs/ReviewGuide/README.md)" +
            " — now hosted in the shared repository.";

        const root = render(current);

        const result = decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText:
                    `The authoritative directory layout and file conventions are documented in [${linkLabel}]` +
                    "(../docs/ReviewGuide/README.md).",
            },
        ]);

        expect(result.inlined).toBe(1);
        const paragraph = root.querySelector<HTMLElement>("p")!;
        expect(words(paragraph).added).toContain("now hosted in the shared repository");

        const indicator = paragraph.querySelector<HTMLElement>(`.${DIFF_METADATA_CLASS}`)!;

        expect(indicator.classList.contains("is-warning")).toBe(true);
        expect(indicator.previousElementSibling?.textContent).toContain(
            "docs/ReviewGuide/README.md",
        );
        expect(indicator.querySelector("button")?.getAttribute("aria-label")).toBe(
            "Show link hostname change",
        );
        expect(indicator.querySelector(".emr-diff-metadata-target-diff")?.textContent).toContain(
            "ReviewGuide/README.md",
        );
        expect(words(indicator).removed).toContain("..");
        expect(words(indicator).added).toContain("example.visualstudio.com");
        expect(paragraph.querySelector(".emr-diff-before-trigger")).toBeNull();
    });
    it("removes link target indicators when changes are hidden", () => {
        const root = render("[Guide](https://example.com/v2)");
        decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "[Guide](https://example.com/v1)",
            },
        ]);
        expect(root.querySelector(`.${DIFF_METADATA_CLASS}`)).not.toBeNull();
        decorate(root, []);
        expect(root.querySelector(`.${DIFF_METADATA_CLASS}`)).toBeNull();
    });
    it("hides a link's native title while its change is explained and restores it after", () => {
        const root = render('Read the [guide](https://example.com/guide "Native link title").');

        const link = root.querySelector<HTMLAnchorElement>("a")!;
        expect(link.title).toBe("Native link title");
        decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "Read the guide.",
            },
        ]);
        expect(link.hasAttribute("title")).toBe(false);
        expectPreciseAmber(
            link.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)!,
            "Link added: https://example.com/guide",
        );
        decorate(root, []);
        expect(link.title).toBe("Native link title");
    });

    it("hides a rich link's native title even when several of its words are explained", () => {
        const root = render('Read [**Alpha** and *beta*](https://example.com/rich "Rich title").');

        const link = root.querySelector<HTMLAnchorElement>("a")!;
        decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "Read Alpha and beta.",
            },
        ]);
        expect(link.hasAttribute("title")).toBe(false);
        expect(link.querySelectorAll(`.${DIFF_TOOLTIP_CLASS}`).length).toBeGreaterThan(1);
        decorate(root, []);
        expect(link.title).toBe("Rich title");
    });
    it("shortens a long link destination in the explanation", () => {
        const destination = `https://example.com/${"deep-path/".repeat(16)}guide`;
        const root = render(`Read the [guide](${destination}).`);
        decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "Read the guide.",
            },
        ]);

        const label = root.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)!.dataset
            .diffTooltip!;

        expect(label).toMatch(/^Link added: https:\/\/example\.com\//);
        expect(label.endsWith("…")).toBe(true);
        expect(label.length).toBeLessThanOrEqual(108);
        expect(root.querySelector<HTMLAnchorElement>("a")!.href).toContain("deep-path/deep-path");
    });
});

describe("applyLinkTargetIndicators", () => {
    it("skips a target change for a link that is no longer rendered", () => {
        const paragraph = document.createElement("p");
        paragraph.innerHTML = `<a href="https://new.example/">one</a>`;

        applyLinkTargetIndicators(paragraph, [
            {
                index: 1,
                before: "https://missing.example/",
                after: "https://other.example/",
                hostChanged: true,
            },
            {
                index: 0,
                before: "https://old.example/",
                after: "https://new.example/",
                hostChanged: true,
            },
        ]);

        const indicators = paragraph.querySelectorAll(`.${DIFF_METADATA_CLASS}`);
        expect(indicators).toHaveLength(1);
        expect(paragraph.querySelector("a")!.nextElementSibling).toBe(indicators[0]);
    });
});
