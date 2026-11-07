import { beforeEach, describe, expect, it } from "vitest";

import {
    DIFF_BLOCK_CLASS,
    DIFF_IMAGE_CLASS,
    DIFF_INLINE_CLASS,
    DIFF_METADATA_CLASS,
    DIFF_TOOLTIP_CLASS,
} from "../src/markdown/diffDecorations";
import { decorate, render, view, words } from "./markdownDiffHarness";

// Rendered diff of images: an image is marked with a minimal media outline
// (never a text wash), and changes to its source, alt text or title are shown
// as metadata.

beforeEach(() => {
    document.body.innerHTML = "";
});

describe("images", () => {
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
        expect(indicator.textContent).toContain("https://example.com/v1.png");
        expect(indicator.textContent).toContain("alt: Legacy architecture");
        expect(indicator.textContent).toContain("https://example.com/v2.png");
        expect(indicator.textContent).toContain("alt: Current architecture");
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
