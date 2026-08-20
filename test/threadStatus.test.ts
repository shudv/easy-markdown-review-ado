import { describe, it, expect } from "vitest";
import { isResolvedLike, type ThreadStatus } from "../src/types";

describe("isResolvedLike", () => {
  it("treats resolved, wontFix, and closed as resolved-like (hidden together)", () => {
    expect(isResolvedLike("resolved")).toBe(true);
    expect(isResolvedLike("wontFix")).toBe(true);
    expect(isResolvedLike("closed")).toBe(true);
  });

  it("treats active and pending as still-open", () => {
    expect(isResolvedLike("active")).toBe(false);
    expect(isResolvedLike("pending")).toBe(false);
  });

  it("covers every ThreadStatus member", () => {
    const all: ThreadStatus[] = [
      "active",
      "resolved",
      "wontFix",
      "closed",
      "pending",
    ];
    // Exactly the three terminal states are resolved-like.
    expect(all.filter(isResolvedLike)).toEqual([
      "resolved",
      "wontFix",
      "closed",
    ]);
  });
});
