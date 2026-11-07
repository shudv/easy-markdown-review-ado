// DOM-level edge cases of ArticleView's extracted helpers (click delegation,
// generated-source decoding, bubble placement, section hydration, anchor
// measurement) and DocNav's CSS escaping, driven against small jsdom fixtures.
//
// @vitest-environment jsdom

import type { MouseEvent as ReactMouseEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    handleGeneratedSourceClick,
    handleHeadingLinkClick,
    handleSectionToggleClick,
} from "../src/shell/components/ArticleView.clicks";
import {
    addGeneratedSourceButtons,
    decodeGeneratedSource,
} from "../src/shell/components/ArticleView.generatedSource";
import { HEADING_LINK_CLASS } from "../src/shell/components/ArticleView.headingLinks";
import { selectionBubblePosition } from "../src/shell/components/ArticleView.selectionBubble";
import { hydrateSections, measureAnchorYs } from "../src/shell/components/ArticleView.wrap";
import { cssEscape } from "../src/shell/components/DocNav.model";

function fixture(html: string): HTMLDivElement {
    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.appendChild(root);

    return root;
}

function rect(top: number, extra: Partial<DOMRect> = {}): DOMRect {
    return {
        top,
        bottom: top,
        left: 0,
        width: 0,
        height: 0,
        ...extra,
    } as DOMRect;
}

afterEach(() => {
    document.body.innerHTML = "";
    sessionStorage.clear();
    vi.unstubAllGlobals();
});

describe("handleHeadingLinkClick", () => {
    it("consumes the click without copying when no copy callback is wired", () => {
        const root = fixture(
            `<button class="${HEADING_LINK_CLASS}" data-heading-id="intro"></button>`,
        );

        const preventDefault = vi.fn();
        const announce = vi.fn();

        const consumed = handleHeadingLinkClick(
            { preventDefault } as unknown as ReactMouseEvent,
            root.querySelector("button")!,
            undefined,
            announce,
        );

        expect(consumed).toBe(true);
        expect(preventDefault).toHaveBeenCalled();
        expect(announce).not.toHaveBeenCalled();
    });
});

describe("generated-source affordance", () => {
    it("adds one Source button per block however often hydration runs", () => {
        const root = fixture('<div class="emr-mermaid" data-mermaid-src="graph%20TD"></div>');

        addGeneratedSourceButtons(root);
        addGeneratedSourceButtons(root);
        expect(root.querySelectorAll(".emr-mermaid-source-btn")).toHaveLength(1);
    });

    it("opens nothing for a Source button whose block lost its source", () => {
        const root = fixture(
            '<div class="emr-mermaid"><button class="emr-mermaid-source-btn"></button></div>',
        );

        const preventDefault = vi.fn();
        const open = vi.fn();

        const consumed = handleGeneratedSourceClick(
            { preventDefault } as unknown as ReactMouseEvent,
            root.querySelector("button")!,
            open,
        );

        expect(consumed).toBe(true);
        expect(preventDefault).toHaveBeenCalled();
        expect(open).not.toHaveBeenCalled();
    });
});

describe("handleSectionToggleClick", () => {
    it("consumes a toggle outside any section without changing it", () => {
        const root = fixture(
            `<button class="emr-section-toggle" aria-label="Collapse section"></button>`,
        );

        const toggle = root.querySelector("button")!;
        const wrap = document.createElement("div");
        const changed = vi.fn();
        wrap.addEventListener("emr-sections-changed", changed);
        expect(handleSectionToggleClick(toggle, "doc.md", { current: wrap })).toBe(true);
        expect(toggle.getAttribute("aria-label")).toBe("Collapse section");
        expect(changed).not.toHaveBeenCalled();
    });

    it("folds a section without an id but persists nothing for it", () => {
        const root = fixture(
            `<section class="emr-section"><h2><button class="emr-section-toggle"></button>Title</h2></section>`,
        );

        const toggle = root.querySelector("button")!;
        const wrap = document.createElement("div");
        const changed = vi.fn();
        wrap.addEventListener("emr-sections-changed", changed);
        handleSectionToggleClick(toggle, "doc.md", { current: wrap });
        expect(root.querySelector("section")!.dataset.collapsed).toBe("true");
        expect(toggle.getAttribute("aria-expanded")).toBe("false");
        expect(sessionStorage).toHaveLength(0);
        expect(changed).toHaveBeenCalledTimes(1);
    });
});

describe("decodeGeneratedSource", () => {
    it("decodes an encoded source attribute", () => {
        expect(decodeGeneratedSource("graph%20TD")).toBe("graph TD");
    });

    it("falls back to the raw value for a malformed escape sequence", () => {
        expect(decodeGeneratedSource("100%25%")).toBe("100%25%");
    });
});

describe("selectionBubblePosition", () => {
    const wrapRect = rect(100, { width: 600 });

    it("sits above a selection that has room above it", () => {
        const pos = selectionBubblePosition(
            rect(300, { bottom: 320, left: 200, width: 100 }),
            wrapRect,
            132,
        );

        expect(pos).toEqual({ top: 164, left: 184 });
    });

    it("tucks below a selection at the very top of the article", () => {
        const pos = selectionBubblePosition(
            rect(110, { bottom: 130, left: 0, width: 20 }),
            wrapRect,
            132,
        );

        expect(pos).toEqual({ top: 38, left: 4 });
    });
});

describe("hydrateSections", () => {
    it("skips the collapse toggle for a section that has no heading", () => {
        sessionStorage.setItem("emr.section.doc.md.body", "1");

        const root = fixture(
            `<section class="emr-section" data-section-id="body"><p>Text</p></section>`,
        );

        hydrateSections(root, "doc.md", true);
        const section = root.querySelector("section")!;
        expect(section.dataset.collapsed).toBe("true");
        expect(root.querySelector(".emr-section-toggle")).toBeNull();
    });
});

describe("measureAnchorYs", () => {
    it("places highlights in collapsed sections at their heading, or the top without one", () => {
        const root = fixture(
            `<section class="emr-section"><h2>Heading</h2><span class="emr-highlight" data-thread-id="t1"></span></section>` +
                `<section class="emr-section"><span class="emr-highlight" data-thread-id="__draft__"></span></section>`,
        );

        root.querySelector("h2")!.getBoundingClientRect = () => rect(140);
        const wrap = document.createElement("div");
        wrap.getBoundingClientRect = () => rect(40);
        const { yByThreadId, draftY } = measureAnchorYs(wrap, root);
        expect(yByThreadId.get("t1")).toBe(100);
        expect(draftY).toBe(0);
    });
});

describe("cssEscape", () => {
    it("uses the native CSS.escape when the browser provides it", () => {
        vi.stubGlobal("CSS", { escape: (s: string) => `native:${s}` });
        expect(cssEscape("a.b")).toBe("native:a.b");
    });

    it("escapes non-identifier characters itself without CSS.escape", () => {
        vi.stubGlobal("CSS", undefined);
        expect(cssEscape("a.b c")).toBe("a\\.b\\ c");
    });
});
