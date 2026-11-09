import { beforeEach, describe, expect, it } from "vitest";

import {
    DIFF_BLOCK_CLASS,
    DIFF_IMAGE_CLASS,
    DIFF_INLINE_CLASS,
    DIFF_METADATA_CLASS,
    DIFF_TOOLTIP_CLASS,
} from "../src/markdown/diffDecorations";
import { decorate, diffView, lines, render, view, words } from "./markdownDiffHarness";

// Rendered diff of images: an image is marked with a minimal media outline
// (never a text wash), and changes to its source, alt text or title are shown
// as metadata.

beforeEach(() => {
    document.body.innerHTML = "";
});

describe("images", () => {
    it.each([
        {
            name: "a paragraph of images on separate lines",
            original: "![a](a.png)\n![b](b.png)",
            current: "![a](a.png)\n![c](c.png)",
            selector: "p",
            outlined: true,
        },
        {
            name: "a list item holding only an image",
            original: "- ![old](old.png)",
            current: "- ![new](new.png)",
            selector: "li",
            outlined: false,
        },
    ])(
        "outlines $name as an image block: $outlined",
        ({ original, current, selector, outlined }) => {
            const { root } = diffView(original, current);

            expect(root.querySelector(selector)?.classList.contains(DIFF_IMAGE_CLASS)).toBe(
                outlined,
            );
        },
    );
    it.each([
        {
            name: "a changed alt text on a standalone image",
            original: "![old alt](a.png)",
            current: "![new alt](a.png)",
            expected: "p modified inline: ⟨Image changed⟩",
        },
        {
            name: "a changed source on an image inside prose",
            original: "See ![icon](a.png) here.",
            current: "See ![icon](b.png) here.",
            expected: "p modified inline: See ⟨Image changed⟩ here.",
        },
    ])("explains $name as an image change", ({ original, current, expected }) => {
        expect(view(original, current)).toEqual([expected]);
    });

    it("marks an added image with a minimal media diff instead of a wash", () => {
        const root = render("![Architecture](https://example.com/v2.png)");

        const res = decorate(root, [{ startLine: 1, endLine: 1, kind: "added" }]);

        const owner = root.querySelector<HTMLElement>("p")!;

        expect(res.decorated).toBe(1);
        expect(owner.classList.contains(DIFF_IMAGE_CLASS)).toBe(true);
        expect(owner.classList.contains("emr-diff-block--added")).toBe(true);
        expect(owner.dataset.diffKind).toBe("added");
    });

    it("washes an added paragraph mixing text and an image as one block, not as media", () => {
        const root = render("Current ![Architecture](https://example.com/v2.png)");

        decorate(root, [{ startLine: 1, endLine: 1, kind: "added" }]);

        const paragraph = root.querySelector<HTMLElement>("p")!;
        expect(paragraph.classList.contains(DIFF_IMAGE_CLASS)).toBe(false);
        expect(paragraph.classList.contains("emr-diff-block--added")).toBe(true);
        expect(paragraph.querySelector(".emr-diff-line-wash")).toBeNull();
    });

    it("washes an added paragraph holding only a non-breaking space as a block, not as media", () => {
        const { root } = diffView(
            lines("One.", "", "Two."),
            lines("One.", "", "&nbsp;", "", "Two."),
        );

        const added = root.querySelector<HTMLElement>('p[data-diff-kind="added"]')!;
        expect(added.classList.contains(DIFF_IMAGE_CLASS)).toBe(false);
    });

    it("outlines an edited image whose previous version is unknown without an amber explanation", () => {
        const root = render("![Architecture](https://example.com/v2.png)");
        decorate(root, [{ startLine: 1, endLine: 1, kind: "modified" }]);
        const owner = root.querySelector<HTMLElement>("p")!;

        expect(owner.classList.contains(DIFF_IMAGE_CLASS)).toBe(true);
        expect(root.querySelector(".emr-diff-before-control")).toBeNull();
        expect(owner.classList.contains(DIFF_TOOLTIP_CLASS)).toBe(false);
    });

    it("shows image source, alt, and title metadata changes", () => {
        const root = render('![Current architecture](https://example.com/v2.png "Current")');

        const res = decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: '![Legacy architecture](https://example.com/v1.png "Legacy")',
            },
        ]);

        expect(res.inlined).toBe(1);
        const image = root.querySelector("img")!;
        expect(root.querySelector("p")?.classList.contains(DIFF_IMAGE_CLASS)).toBe(true);
        expect(root.querySelector("p")?.classList.contains(DIFF_INLINE_CLASS)).toBe(true);
        const indicator = image.nextElementSibling!;
        expect(indicator.classList.contains(DIFF_METADATA_CLASS)).toBe(true);

        const row = (side: string) => {
            const el = indicator.querySelector(`.emr-diff-metadata-row--${side}`)!;

            return [
                el.querySelector(".emr-diff-metadata-label")?.textContent,
                el.querySelector(".emr-diff-metadata-value")?.textContent,
            ];
        };

        expect([row("before"), row("after")]).toEqual([
            ["Before ", "https://example.com/v1.png (alt: Legacy architecture; title: Legacy)"],
            ["After ", "https://example.com/v2.png (alt: Current architecture; title: Current)"],
        ]);
    });

    it("opens and closes an image change's details from its button", () => {
        const root = render("![Current](https://example.com/v2.png)");
        decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "![Legacy](https://example.com/v1.png)",
            },
        ]);
        const indicator = root.querySelector<HTMLElement>(`.${DIFF_METADATA_CLASS}`)!;
        const trigger = indicator.querySelector<HTMLButtonElement>(".emr-diff-metadata-trigger")!;
        expect(indicator.querySelector(".emr-diff-metadata-panel")?.getAttribute("role")).toBe(
            "tooltip",
        );
        expect(trigger.getAttribute("aria-expanded")).toBe("false");

        trigger.click();
        expect(indicator.classList.contains("is-open")).toBe(true);
        expect(trigger.getAttribute("aria-expanded")).toBe("true");

        trigger.click();
        expect(indicator.classList.contains("is-open")).toBe(false);
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
    });

    it("explains an image whose title alone changed", () => {
        expect(view('![a](a.png "Old title")', '![a](a.png "New title")')).toEqual([
            "p modified inline: ⟨Image changed⟩",
        ]);
    });

    it("describes an inline HTML image without alt text", () => {
        const { root } = diffView('Logo: <img src="logo.png">', 'Logo: <img src="logo-v2.png">');

        expect(root.querySelector(".emr-diff-metadata-row--before")?.textContent).toBe(
            "Before logo.png (alt: no alt text)",
        );
    });

    it("marks a paragraph of images as edited when one of its images was removed", () => {
        const { root } = diffView("![a](a.png) ![b](b.png)", "![a](a.png)");

        expect(root.querySelector("p")?.dataset.diffKind).toBe("modified");
    });

    it.each([
        {
            name: "one of two images removed from a sentence",
            original: "Look ![cat](cat.png) ![dog](dog.png) here.",
            current: "Look ![cat](cat.png) here.",
            expected: "p modified inline: Look [-dog -]here.",
        },
        {
            name: "the only image removed from a sentence",
            original: "Look ![cat](cat.png) here.",
            current: "Look here.",
            expected: "p modified inline: Look [-cat -]here.",
        },
        {
            name: "an image without alt text removed from a sentence",
            original: "Look ![](cat.png) ![](dog.png) here.",
            current: "Look ![](cat.png) here.",
            expected: "p modified inline: Look [-dog.png -]here.",
        },
    ])("strikes the description of $name", ({ original, current, expected }) => {
        expect(view(original, current)).toEqual([expected]);
    });

    it("describes title-less image source and alt changes", () => {
        const root = render("![Current](https://example.com/v2.png)");
        decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "![Legacy](https://example.com/v1.png)",
            },
        ]);
        const indicator = root.querySelector(`.${DIFF_METADATA_CLASS}`)!;
        expect(indicator.textContent).toContain("Before https://example.com/v1.png (alt: Legacy)");
        expect(indicator.textContent).toContain("After https://example.com/v2.png (alt: Current)");
    });
    it("strikes the old text when text was replaced by an image", () => {
        const root = render("![Architecture](https://example.com/v2.png)");

        const res = decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "Architecture",
            },
        ]);

        expect(res.inlined).toBe(1);
        expect(words(root).removed).toContain("Architecture");
        expect(root.querySelector(`.${DIFF_METADATA_CLASS}`)).toBeNull();
    });

    it("outlines an added raw HTML image and clears the outline when changes are hidden", () => {
        const root = render('<img src="a.png">');
        const image = root.querySelector<HTMLImageElement>("img")!;

        const result = decorate(root, [{ startLine: 1, endLine: 1, kind: "added" }]);

        expect(result.decorated).toBe(1);
        expect(image.classList.contains(DIFF_IMAGE_CLASS)).toBe(true);

        decorate(root, []);
        expect(image.classList.contains(DIFF_IMAGE_CLASS)).toBe(false);
        expect(image.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
    });
});
