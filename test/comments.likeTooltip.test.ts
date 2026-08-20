import { describe, expect, it } from "vitest";

import { formatLikeTooltip } from "../src/comments/likeTooltip";
import type { ReactionUser } from "../src/types";

const u = (id: string, displayName: string): ReactionUser => ({
  id,
  displayName,
});

describe("formatLikeTooltip", () => {
  it("returns an empty string when nobody liked", () => {
    expect(formatLikeTooltip([], "me")).toBe("");
  });

  it("names a single liker", () => {
    expect(formatLikeTooltip([u("a", "Ada")], "me")).toBe("Ada liked this");
  });

  it('shows the current user first as "You"', () => {
    expect(formatLikeTooltip([u("a", "Ada"), u("me", "Me")], "me")).toBe(
      "You and Ada liked this",
    );
  });

  it("joins two likers with 'and'", () => {
    expect(formatLikeTooltip([u("a", "Ada"), u("b", "Bob")], "me")).toBe(
      "Ada and Bob liked this",
    );
  });

  it("uses an Oxford-style 'and' for three-to-five names", () => {
    expect(
      formatLikeTooltip([u("a", "Ada"), u("b", "Bob"), u("c", "Cy")], "me"),
    ).toBe("Ada, Bob and Cy liked this");
  });

  it("collapses more than five likers into 'and N others'", () => {
    const users = [
      u("a", "Ada"),
      u("b", "Bob"),
      u("c", "Cy"),
      u("d", "Dee"),
      u("e", "Eve"),
      u("f", "Fin"),
      u("g", "Gus"),
    ];
    expect(formatLikeTooltip(users, "me")).toBe(
      "Ada, Bob, Cy, Dee, Eve and 2 others liked this",
    );
  });

  it("uses the singular 'other' when exactly one is hidden", () => {
    const users = [
      u("a", "Ada"),
      u("b", "Bob"),
      u("c", "Cy"),
      u("d", "Dee"),
      u("e", "Eve"),
      u("f", "Fin"),
    ];
    expect(formatLikeTooltip(users, "me")).toBe(
      "Ada, Bob, Cy, Dee, Eve and 1 other liked this",
    );
  });

  it("shrinks the shown names when they exceed the character budget", () => {
    // Five very long names would blow past the 120-char budget, so the
    // formatter shows fewer names and folds the rest into "and N others".
    const long = (n: number) => "X".repeat(40) + n;
    const users = [
      u("a", long(1)),
      u("b", long(2)),
      u("c", long(3)),
      u("d", long(4)),
      u("e", long(5)),
    ];
    const out = formatLikeTooltip(users, "me");
    expect(out.endsWith(" liked this")).toBe(true);
    // Budget keeps the body (excluding the fixed suffix) within 120 chars.
    expect(out.length).toBeLessThanOrEqual(120 + " liked this".length);
    expect(out).toMatch(/and \d+ others liked this$/);
  });
});
