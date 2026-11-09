import { describe, expect, it } from "vitest";

import {
    classifyDiffElement,
    markerFraction,
    markerInViewport,
    mergeMarkers,
    resolveOverlaps,
    scrollFromThumbDrag,
    scrollTargetForFraction,
    thumbMetrics,
    viewportRange,
    type DiffMarker,
} from "../src/shell/components/diffMinimap.helpers";

function el(className: string): Element {
    const d = document.createElement("div");
    d.className = className;

    return d;
}

describe("classifyDiffElement", () => {
    it.each([
        ["emr-diff-deleted-marker", "deleted"],
        ["emr-diff-block emr-diff-block--added", "added"],
        ["emr-diff-block emr-diff-block--modified", "modified"],
    ])("marks an element with class %s as %s", (className, kind) => {
        expect(classifyDiffElement(el(className))).toBe(kind);
    });
    it("returns null for an undecorated element", () => {
        expect(classifyDiffElement(el("emr-diff-block"))).toBeNull();
    });
});

describe("markerFraction", () => {
    it("normalises pixel offset + height against the content height", () => {
        expect(markerFraction(250, 50, 1000)).toEqual({
            top: 0.25,
            height: 0.05,
        });
    });
    it.each([
        {
            name: "an element past the end of the content pins to the bottom",
            offset: 2000,
            height: 5000,
            content: 1000,
            fraction: { top: 1, height: 1 },
        },
        {
            name: "an element above the content top pins to the top",
            offset: -100,
            height: 50,
            content: 1000,
            fraction: { top: 0, height: 0.05 },
        },
        {
            name: "an empty document places markers at the top with no height",
            offset: 10,
            height: 10,
            content: 0,
            fraction: { top: 0, height: 0 },
        },
    ])("$name", ({ offset, height, content, fraction }) => {
        expect(markerFraction(offset, height, content)).toEqual(fraction);
    });
});

describe("mergeMarkers", () => {
    it("merges same-kind ticks within the gap into one span", () => {
        const marks: DiffMarker[] = [
            { top: 0.1, height: 0.02, kind: "added" },
            { top: 0.13, height: 0.02, kind: "added" }, // gap 0.01 ≤ 0.02 → merge
        ];

        const merged = mergeMarkers(marks, 0.02);
        expect(merged).toHaveLength(1);
        expect(merged[0]!.kind).toBe("added");
        expect(merged[0]!.top).toBeCloseTo(0.1);
        expect(merged[0]!.height).toBeCloseTo(0.05); // 0.1 → 0.15
    });
    it("merges same-kind ticks that touch exactly", () => {
        const marks: DiffMarker[] = [
            { top: 0.25, height: 0.25, kind: "added" },
            { top: 0.5, height: 0.25, kind: "added" },
        ];

        expect(mergeMarkers(marks, 0)).toEqual([{ top: 0.25, height: 0.5, kind: "added" }]);
    });

    it("keeps a block's full extent when a shorter same-kind tick sits inside it", () => {
        const marks: DiffMarker[] = [
            { top: 0.25, height: 0.5, kind: "modified" },
            { top: 0.375, height: 0.125, kind: "modified" },
        ];

        expect(mergeMarkers(marks, 0)).toEqual([{ top: 0.25, height: 0.5, kind: "modified" }]);
    });

    it("keeps different kinds separate even when adjacent", () => {
        const marks: DiffMarker[] = [
            { top: 0.1, height: 0.02, kind: "added" },
            { top: 0.12, height: 0.02, kind: "deleted" },
        ];

        expect(mergeMarkers(marks, 0.05)).toHaveLength(2);
    });
    it("keeps far-apart same-kind ticks separate", () => {
        const marks: DiffMarker[] = [
            { top: 0.1, height: 0.02, kind: "modified" },
            { top: 0.5, height: 0.02, kind: "modified" },
        ];

        expect(mergeMarkers(marks, 0.02)).toHaveLength(2);
    });
    it("sorts out-of-order input before merging", () => {
        const marks: DiffMarker[] = [
            { top: 0.5, height: 0.02, kind: "added" },
            { top: 0.1, height: 0.02, kind: "added" },
        ];

        const merged = mergeMarkers(marks, 0.02);
        expect(merged[0]).toEqual({ top: 0.1, height: 0.02, kind: "added" });
        expect(merged).toHaveLength(2);
    });
});

describe("resolveOverlaps", () => {
    it("keeps non-overlapping ticks, in document order", () => {
        const out = resolveOverlaps([
            { top: 0.1, height: 0.05, kind: "added" },
            { top: 0.4, height: 0.05, kind: "deleted" },
            { top: 0.8, height: 0.05, kind: "modified" },
            { top: 0.6, height: 0.05, kind: "deleted" },
        ]);

        expect(out.map((m) => m.top)).toEqual([0.1, 0.4, 0.6, 0.8]);
    });

    it("keeps a block whole when a deletion sits below it", () => {
        const marks: DiffMarker[] = [
            { top: 0.25, height: 0.125, kind: "added" },
            { top: 0.5, height: 0.125, kind: "deleted" },
        ];

        expect(resolveOverlaps(marks)).toEqual(marks);
    });

    it.each([
        {
            name: "top",
            deletion: { top: 0.25, height: 0.125 },
            expected: [
                { top: 0.25, height: 0.125, kind: "deleted" },
                { top: 0.375, height: 0.375, kind: "modified" },
            ],
        },
        {
            name: "bottom",
            deletion: { top: 0.625, height: 0.125 },
            expected: [
                { top: 0.25, height: 0.375, kind: "modified" },
                { top: 0.625, height: 0.125, kind: "deleted" },
            ],
        },
    ])(
        "leaves one part of an edited block around a deletion at its very $name",
        ({ deletion, expected }) => {
            const out = resolveOverlaps([
                { top: 0.25, height: 0.5, kind: "modified" },
                { ...deletion, kind: "deleted" },
            ]);

            expect(out).toEqual(expected);
        },
    );

    it("draws nothing for a document without changes", () => {
        expect(resolveOverlaps([])).toEqual([]);
    });
    it("splits the enclosing block around a deletion inside it", () => {
        const marks: DiffMarker[] = [
            { top: 0.2, height: 0.3, kind: "modified" }, // 0.2..0.5
            { top: 0.35, height: 0.05, kind: "deleted" }, // 0.35..0.4 inside it
        ];

        const out = resolveOverlaps(marks);
        // edit · removed · edit
        expect(out.map((m) => m.kind)).toEqual(["modified", "deleted", "modified"]);
        expect(out[0]!.top).toBeCloseTo(0.2);
        expect(out[0]!.height).toBeCloseTo(0.15); // 0.2..0.35
        expect(out[1]!.top).toBeCloseTo(0.35);
        expect(out[1]!.height).toBeCloseTo(0.05); // 0.35..0.4
        expect(out[2]!.top).toBeCloseTo(0.4);
        expect(out[2]!.height).toBeCloseTo(0.1); // 0.4..0.5
    });
    it("clips a block to the part above a deletion that extends past it", () => {
        const marks: DiffMarker[] = [
            { top: 0.2, height: 0.2, kind: "added" }, // 0.2..0.4
            { top: 0.35, height: 0.15, kind: "deleted" }, // 0.35..0.5
        ];

        const out = resolveOverlaps(marks);
        const add = out.find((m) => m.kind === "added")!;
        const del = out.find((m) => m.kind === "deleted")!;
        expect(add.top).toBeCloseTo(0.2);
        expect(add.height).toBeCloseTo(0.15); // clipped to 0.2..0.35
        expect(del.top).toBeCloseTo(0.35);
        expect(del.height).toBeCloseTo(0.15); // deletion keeps its full span
    });
    it("drops a block fully covered by a larger deletion", () => {
        const marks: DiffMarker[] = [
            { top: 0.3, height: 0.1, kind: "modified" }, // 0.3..0.4
            { top: 0.2, height: 0.4, kind: "deleted" }, // 0.2..0.6 covers it
        ];

        const out = resolveOverlaps(marks);
        expect(out).toHaveLength(1);
        expect(out[0]!.kind).toBe("deleted");
        expect(out[0]!.top).toBeCloseTo(0.2);
        expect(out[0]!.height).toBeCloseTo(0.4);
    });
    const added: DiffMarker = { top: 0.1, height: 0.2, kind: "added" }; // 0.1..0.3
    const modified: DiffMarker = { top: 0.25, height: 0.2, kind: "modified" }; // keep 0.3..0.45

    it.each([
        { name: "in document order", marks: [added, modified] },
        { name: "listed bottom-first", marks: [modified, added] },
    ])("lets the topmost block win when two blocks overlap, $name", ({ marks }) => {
        const out = resolveOverlaps(marks);
        const mod = out.find((m) => m.kind === "modified")!;
        expect(mod.top).toBeCloseTo(0.3);
        expect(mod.height).toBeCloseTo(0.15);
    });
});

describe("viewportRange", () => {
    it("expresses the on-screen window as fractions", () => {
        expect(viewportRange(200, 400, 2000)).toEqual({
            top: 0.1,
            height: 0.2,
        });
    });
    it("defaults to the whole ruler for a zero-height document", () => {
        expect(viewportRange(0, 100, 0)).toEqual({ top: 0, height: 1 });
    });
});

describe("scrollTargetForFraction", () => {
    it("centres the clicked fraction in the viewport", () => {
        // fraction 0.5 of a 2000px doc = 1000; minus half of a 400px viewport = 800.
        expect(scrollTargetForFraction(0.5, 2000, 400)).toBe(800);
    });
    it.each([
        { name: "the top scrolls to the start", fraction: 0, target: 0 },
        { name: "the bottom scrolls to the end, not past it", fraction: 1, target: 1600 },
    ])("clicking $name", ({ fraction, target }) => {
        expect(scrollTargetForFraction(fraction, 2000, 400)).toBe(target);
    });
});

describe("markerInViewport", () => {
    const vp = { top: 0.4, height: 0.2 }; // [0.4, 0.6]
    it("is true when the marker overlaps the viewport", () => {
        expect(markerInViewport({ top: 0.55, height: 0.1, kind: "added" }, vp)).toBe(true);
    });
    it("is false when the marker sits entirely outside", () => {
        expect(markerInViewport({ top: 0.7, height: 0.05, kind: "added" }, vp)).toBe(false);
    });

    it("is true for a marker that starts above the viewport and reaches into it", () => {
        expect(markerInViewport({ top: 0.3, height: 0.2, kind: "added" }, vp)).toBe(true);
    });

    const lowerView = { top: 0.5, height: 0.25 }; // [0.5, 0.75]

    it.each([
        { name: "entirely above it", marker: { top: 0.125, height: 0.125 } },
        { name: "ending right where it starts", marker: { top: 0.25, height: 0.25 } },
        { name: "starting right where it ends", marker: { top: 0.75, height: 0.125 } },
    ])("is false for a marker $name", ({ marker }) => {
        expect(markerInViewport({ ...marker, kind: "deleted" }, lowerView)).toBe(false);
    });
});

/** Build the scroller/track geometry the thumb helpers take. */
function geometry(clientHeight: number, scrollHeight: number, trackPx: number, minThumbPx: number) {
    return { clientHeight, scrollHeight, trackPx, minThumbPx };
}

describe("thumbMetrics", () => {
    it("sizes the thumb by the visible fraction", () => {
        // 100 visible of 400 total over a 200px track → 50px thumb at the top.
        expect(thumbMetrics(0, geometry(100, 400, 200, 20))).toEqual({
            topPx: 0,
            heightPx: 50,
        });
    });
    it("sits flush with the track bottom at max scroll", () => {
        // maxScroll = 300; at the bottom the thumb bottom == track bottom (200).
        const m = thumbMetrics(300, geometry(100, 400, 200, 20));
        expect(m.heightPx).toBe(50);
        expect(m.topPx).toBe(150); // 150 + 50 == 200
    });
    it("sits halfway down the free track at half scroll", () => {
        expect(thumbMetrics(150, geometry(100, 400, 200, 20))).toEqual({
            topPx: 75,
            heightPx: 50,
        });
    });

    it("honours the min thumb height but still bottoms out correctly", () => {
        // Proportional height would be 1px; clamped up to 20px.
        const m = thumbMetrics(990, geometry(10, 1000, 100, 20));
        expect(m.heightPx).toBe(20);
        expect(m.topPx).toBe(80); // 80 + 20 == 100 (track bottom), no overshoot
    });
    it("fills the track when the document fits", () => {
        expect(thumbMetrics(0, geometry(400, 400, 200, 20))).toEqual({
            topPx: 0,
            heightPx: 200,
        });
    });
});

describe("scrollFromThumbDrag", () => {
    it("tracks the pointer 1:1 across the available track", () => {
        // thumb 50px on a 200px track → 150px of travel maps to 300px of scroll.
        expect(scrollFromThumbDrag(0, 50, geometry(100, 400, 200, 20))).toBe(100);
    });
    it("continues a drag that starts mid-document from where the thumb is", () => {
        // thumb at 75px of 150px travel; +30px → 105px → 210px of 300px scroll.
        expect(scrollFromThumbDrag(150, 30, geometry(100, 400, 200, 20))).toBe(210);
    });

    it("clamps a drag past the bottom (no over-scroll)", () => {
        expect(scrollFromThumbDrag(300, 100, geometry(100, 400, 200, 20))).toBe(300);
    });
    it("is a no-op when the document fits", () => {
        expect(scrollFromThumbDrag(0, 50, geometry(400, 400, 200, 20))).toBe(0);
    });
    it("is a no-op when the track is shorter than the min thumb", () => {
        // trackPx 20 < minThumb 28 → thumb fills the track → nothing to drag.
        expect(scrollFromThumbDrag(0, 50, geometry(40, 400, 20, 28))).toBe(0);
    });
});
