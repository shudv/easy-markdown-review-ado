import { describe, it, expect } from "vitest";

import {
    orderComments,
    isAnchored,
    type OrderableComment,
} from "../src/shell/components/commentOrder";

describe("orderComments", () => {
    it("orders anchored comments by document position (top first)", () => {
        const items: OrderableComment[] = [
            { id: "b", anchorY: 500, createdAt: 1 },
            { id: "a", anchorY: 100, createdAt: 1 },
            { id: "c", anchorY: 900, createdAt: 1 },
        ];

        expect(orderComments(items)).toEqual(["a", "b", "c"]);
    });

    it("puts unanchored comments after every anchored one", () => {
        const items: OrderableComment[] = [
            { id: "anchored-low", anchorY: 800, createdAt: 1 },
            { id: "general", anchorY: null, createdAt: 999 },
            { id: "anchored-high", anchorY: 50, createdAt: 1 },
        ];

        expect(orderComments(items)).toEqual(["anchored-high", "anchored-low", "general"]);
    });

    it("breaks ties at the same anchor position by newest first", () => {
        const items: OrderableComment[] = [
            { id: "older", anchorY: 200, createdAt: 1000 },
            { id: "newer", anchorY: 200, createdAt: 5000 },
        ];

        expect(orderComments(items)).toEqual(["newer", "older"]);
    });

    it("orders the unanchored group newest first", () => {
        const items: OrderableComment[] = [
            { id: "oldest", anchorY: null, createdAt: 100 },
            { id: "newest", anchorY: null, createdAt: 900 },
            { id: "middle", anchorY: null, createdAt: 500 },
        ];

        expect(orderComments(items)).toEqual(["newest", "middle", "oldest"]);
    });

    it("does not mutate its input", () => {
        const items: OrderableComment[] = [
            { id: "b", anchorY: 500, createdAt: 1 },
            { id: "a", anchorY: 100, createdAt: 1 },
        ];

        const snapshot = items.map((i) => i.id);
        orderComments(items);
        expect(items.map((i) => i.id)).toEqual(snapshot);
    });

    it("keeps comments at the same position and time in their original order", () => {
        const items: OrderableComment[] = [
            { id: "first", anchorY: 100, createdAt: 42 },
            { id: "second", anchorY: 100, createdAt: 42 },
        ];

        expect(orderComments(items)).toEqual(["first", "second"]);
    });
});

describe("isAnchored", () => {
    it.each([
        { name: "a comment at the very top of the document", anchorY: 0, anchored: true },
        { name: "a comment further down", anchorY: 250, anchored: true },
        { name: "a comment with no position in the document", anchorY: null, anchored: false },
    ])("treats $name as anchored: $anchored", ({ anchorY, anchored }) => {
        expect(isAnchored(anchorY)).toBe(anchored);
    });
});
