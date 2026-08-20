import { describe, it, expect } from "vitest";

import {
  orderComments,
  compareComments,
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
      { id: "general", anchorY: null, createdAt: 999 },
      { id: "anchored-low", anchorY: 800, createdAt: 1 },
      { id: "anchored-high", anchorY: 50, createdAt: 1 },
    ];
    expect(orderComments(items)).toEqual([
      "anchored-high",
      "anchored-low",
      "general",
    ]);
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

  it("handles a mixed set end to end", () => {
    const items: OrderableComment[] = [
      { id: "g-new", anchorY: null, createdAt: 9000 },
      { id: "a-top-old", anchorY: 100, createdAt: 10 },
      { id: "a-top-new", anchorY: 100, createdAt: 20 },
      { id: "a-bottom", anchorY: 700, createdAt: 5 },
      { id: "g-old", anchorY: null, createdAt: 1000 },
    ];
    expect(orderComments(items)).toEqual([
      "a-top-new", // anchored @100, newer of the tie
      "a-top-old", // anchored @100, older of the tie
      "a-bottom", // anchored @700
      "g-new", // unanchored, newest first
      "g-old",
    ]);
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
});

describe("compareComments", () => {
  it("is a stable comparator (returns 0 for equivalent items)", () => {
    const x: OrderableComment = { id: "x", anchorY: 100, createdAt: 42 };
    const y: OrderableComment = { id: "y", anchorY: 100, createdAt: 42 };
    expect(compareComments(x, y)).toBe(0);
  });
});

describe("isAnchored", () => {
  it("treats a numeric Y as anchored and null as unanchored", () => {
    expect(isAnchored(0)).toBe(true);
    expect(isAnchored(250)).toBe(true);
    expect(isAnchored(null)).toBe(false);
  });
});
