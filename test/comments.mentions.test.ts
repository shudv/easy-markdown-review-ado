// Tests for mention trigger detection, markdown encode/decode, and
// the author→suggestion helper. Pure data — no DOM dependency.

import { describe, expect, it } from "vitest";

import {
  authorToUserSuggestion,
  buildMentionMarkdown,
  collectMentionIdentities,
  collectUserMentionIds,
  detectActiveTrigger,
  encodePickedMentions,
  mergeMentionIdentities,
  normalizeIdentityGuid,
  parseMentionUrl,
  preprocessUserMentions,
  uniqueMentionLabel,
  type MentionSuggestion,
  type PullRequestSuggestion,
  type UserSuggestion,
  type WorkItemSuggestion,
} from "../src/comments/mentions";
import type { CommentAuthor } from "../src/types";

const USER: UserSuggestion = {
  kind: "user",
  id: "user-abc",
  displayName: "Alice Anderson",
  initials: "AA",
};

const WI: WorkItemSuggestion = {
  kind: "workitem",
  id: "11612",
  workItemType: "Bug",
  title: "Fix the [thing]",
  state: "Active",
  stateColor: "#cc293d",
};

const PR: PullRequestSuggestion = {
  kind: "pullrequest",
  id: "5058",
  title: "Improve perf",
  status: "active",
  repository: "OneTodo",
};

describe("detectActiveTrigger", () => {
  it("returns null for caret outside the string", () => {
    expect(detectActiveTrigger("hello", -1)).toBeNull();
    expect(detectActiveTrigger("hello", 999)).toBeNull();
  });

  it("returns null when the caret is one past the end, even with a reachable trigger", () => {
    // `@` is within look-back range, but caret > text.length must still bail —
    // this guards the upper-bound check, not just the no-trigger fall-through.
    expect(detectActiveTrigger("@ab", 4)).toBeNull();
  });

  it("returns null when there's no trigger char before the caret", () => {
    expect(detectActiveTrigger("hello there", 11)).toBeNull();
  });

  it("detects an @-trigger at start of input", () => {
    const r = detectActiveTrigger("@al", 3);
    expect(r).toEqual({
      kind: "user",
      char: "@",
      start: 0,
      end: 3,
      query: "al",
    });
  });

  it("detects a #-trigger after whitespace", () => {
    const r = detectActiveTrigger("hi #foo", 7);
    expect(r?.kind).toBe("workitem");
    expect(r?.start).toBe(3);
    expect(r?.query).toBe("foo");
  });

  it("detects a !-trigger after a newline", () => {
    const r = detectActiveTrigger("line1\n!42", 9);
    expect(r?.kind).toBe("pullrequest");
    expect(r?.query).toBe("42");
  });

  it("refuses to open the picker for `@` that's part of an email", () => {
    // `me@example` — `@` is preceded by `e`, so we must NOT fire.
    expect(detectActiveTrigger("me@example", 10)).toBeNull();
  });

  it("refuses to open the picker for `#tag` glued to a word", () => {
    expect(detectActiveTrigger("hello#tag", 9)).toBeNull();
  });

  it("returns null when the trigger has been closed by punctuation", () => {
    expect(detectActiveTrigger("@alice, hi", 10)).toBeNull();
  });

  it("respects the 64-char look-back cap", () => {
    const filler = "a".repeat(80);
    expect(detectActiveTrigger(`@${filler}`, filler.length + 1)).toBeNull();
  });

  it("treats a trigger char immediately at caret as an empty query", () => {
    expect(detectActiveTrigger("@", 1)).toEqual({
      kind: "user",
      char: "@",
      start: 0,
      end: 1,
      query: "",
    });
  });

  it("allows spaces, dots, dashes, underscores in the in-progress query", () => {
    const r = detectActiveTrigger("@Alice An.der-son_", 18);
    expect(r?.query).toBe("Alice An.der-son_");
  });
});

describe("buildMentionMarkdown", () => {
  it("emits the ADO-native `@<GUID>` token for user mentions (with trailing space)", () => {
    expect(buildMentionMarkdown(USER)).toBe("@<user-abc> ");
  });

  it("user mention token carries only the id — the display name isn't persisted", () => {
    const u: UserSuggestion = {
      ...USER,
      displayName: "Smart [Inc] \\ Guy",
    };
    // The name never enters the token (ADO + our renderer resolve it from the
    // id), so no label escaping is needed and the output is name-independent.
    expect(buildMentionMarkdown(u)).toBe("@<user-abc> ");
  });

  it("emits a `mention://workitem/<id>?type=...&state=...&stateColor=...` link", () => {
    const md = buildMentionMarkdown(WI);
    // Label embeds id + title.
    expect(md).toMatch(/^\[#11612 Fix the \\\[thing\\\]\]/);
    expect(md).toContain("mention://workitem/11612?");
    expect(md).toContain("type=Bug");
    expect(md).toContain("state=Active");
    expect(md).toContain("stateColor=%23cc293d");
  });

  it("omits stateColor when the suggestion has none", () => {
    const md = buildMentionMarkdown({ ...WI, stateColor: undefined });
    expect(md).not.toContain("stateColor=");
  });

  it("emits a `mention://pullrequest/<id>?status=...&repo=...` link", () => {
    const md = buildMentionMarkdown(PR);
    expect(md).toContain("mention://pullrequest/5058?");
    expect(md).toContain("status=active");
    expect(md).toContain("repo=OneTodo");
  });

  it("omits repo when missing", () => {
    const md = buildMentionMarkdown({ ...PR, repository: undefined });
    expect(md).not.toContain("repo=");
  });
});

describe("parseMentionUrl", () => {
  it("returns null for non-mention URLs", () => {
    expect(parseMentionUrl("https://example.com")).toBeNull();
    expect(parseMentionUrl("javascript:alert(1)")).toBeNull();
    expect(parseMentionUrl("")).toBeNull();
  });

  it("returns null when the kind segment is unknown", () => {
    expect(parseMentionUrl("mention://group/42")).toBeNull();
  });

  it("returns null when there's no `/` after the scheme", () => {
    expect(parseMentionUrl("mention://user")).toBeNull();
  });

  it("decodes a user mention with no params", () => {
    expect(parseMentionUrl("mention://user/user-abc")).toEqual({
      kind: "user",
      id: "user-abc",
      params: {},
    });
  });

  it("decodes a workitem mention with query params", () => {
    expect(
      parseMentionUrl("mention://workitem/123?type=Bug&state=Active"),
    ).toEqual({
      kind: "workitem",
      id: "123",
      params: { type: "Bug", state: "Active" },
    });
  });

  it("round-trips work item / PR mentions through buildMentionMarkdown → parseMentionUrl", () => {
    function urlFromMd(md: string): string {
      const m = md.match(/\]\((mention:\/\/[^)]+)\)/);
      return m?.[1] ?? "";
    }
    // User mentions now persist as the ADO-native `@<GUID>` token (covered by
    // preprocessUserMentions), so only work item / PR mentions are link-shaped.
    const all: MentionSuggestion[] = [WI, PR];
    for (const s of all) {
      const parsed = parseMentionUrl(urlFromMd(buildMentionMarkdown(s)));
      expect(parsed?.kind).toBe(s.kind);
      expect(parsed?.id).toBe(s.id);
    }
  });

  it("decodes percent-encoded ids", () => {
    expect(parseMentionUrl("mention://user/foo%20bar")).toEqual({
      kind: "user",
      id: "foo bar",
      params: {},
    });
  });

  it("parses an empty id when the query starts immediately (`?` at index 0)", () => {
    // `rest` begins with "?": the id slice is empty but params still parse —
    // guards the `q < 0` / `q >= 0` boundary handling.
    expect(parseMentionUrl("mention://user/?type=Bug")).toEqual({
      kind: "user",
      id: "",
      params: { type: "Bug" },
    });
  });
});

describe("preprocessUserMentions", () => {
  const GUID = "6b71186c-c2e6-6813-b4e0-ffcd511163f4";

  it("rewrites `@<GUID>` into a mention://user link (survives parsing)", () => {
    const out = preprocessUserMentions(`Hey @<${GUID}> please review`);
    expect(out).toBe(`Hey [@${GUID}](mention://user/${GUID}) please review`);
  });

  it("is a full round-trip with buildMentionMarkdown for a user", () => {
    const token = buildMentionMarkdown({
      kind: "user",
      id: GUID,
      displayName: "Ignored",
      initials: "IG",
    }).trim();
    expect(token).toBe(`@<${GUID}>`);
    const link = preprocessUserMentions(token);
    const url = link.match(/\]\((mention:\/\/[^)]+)\)/)?.[1] ?? "";
    const parsed = parseMentionUrl(url);
    expect(parsed).toMatchObject({ kind: "user", id: GUID });
  });

  it("rewrites multiple mentions and is case-insensitive on the hex", () => {
    const g2 = "AABBCCDD-1122-3344-5566-778899AABBCC";
    const out = preprocessUserMentions(`@<${GUID}> and @<${g2}>`);
    expect(out).toContain(`mention://user/${GUID}`);
    expect(out).toContain(`mention://user/${encodeURIComponent(g2)}`);
  });

  it("leaves non-GUID `@<...>` and plain text untouched", () => {
    expect(preprocessUserMentions("email <a@b.com> and @notaguid")).toBe(
      "email <a@b.com> and @notaguid",
    );
    expect(preprocessUserMentions("@<not-a-guid>")).toBe("@<not-a-guid>");
  });
});

describe("collectUserMentionIds", () => {
  const A = "6b71186c-c2e6-6813-b4e0-ffcd511163f4";
  const B = "08538e47-5e28-6ce6-9c31-f3f9b23418fb";

  it("collects ids from the native `@<GUID>` token form", () => {
    expect(collectUserMentionIds(`cc @<${A}> and @<${B}>`)).toEqual([A, B]);
  });

  it("collects ids from the `mention://user/<id>` link form", () => {
    const body = `[@${A}](mention://user/${A}) [@x](mention://user/u-alex)`;
    expect(collectUserMentionIds(body)).toEqual([A, "u-alex"]);
  });

  it("de-duplicates the same id across both forms (case-insensitively)", () => {
    const body = `@<${A}> again [@a](mention://user/${A.toUpperCase()})`;
    expect(collectUserMentionIds(body)).toEqual([A]);
  });

  it("url-decodes ids in the link form", () => {
    const body = "[@x](mention://user/a%20b)";
    expect(collectUserMentionIds(body)).toEqual(["a b"]);
  });

  it("skips a link id that decodes to only whitespace", () => {
    expect(collectUserMentionIds("[@x](mention://user/%20)")).toEqual([]);
  });

  it("returns an empty array when there are no mentions", () => {
    expect(collectUserMentionIds("just prose, no mentions")).toEqual([]);
  });
});

describe("collectMentionIdentities", () => {
  const A = "6b71186c-c2e6-6813-b4e0-ffcd511163f4";
  const B = "140e7feb-6e57-4d7b-8de6-474d9b9813db";

  const lookup =
    (map: Record<string, { displayName: string; avatarUrl?: string }>) =>
    (id: string) =>
      map[id.toLowerCase()];

  it("resolves picked names for a body's @mentions (normalizing the id)", () => {
    const body = `hi @<${A.toUpperCase()}> and @<${B}> [@x](mention://user/u-alex)`;
    const out = collectMentionIdentities(
      body,
      lookup({
        [A]: { displayName: "Shubham Dwivedi", avatarUrl: "a" },
        [B]: { displayName: "Alex" },
        ["u-alex"]: { displayName: "Legacy Link User" },
      }),
    );
    expect(out).toEqual([
      { id: A, displayName: "Shubham Dwivedi", avatarUrl: "a" },
      { id: B, displayName: "Alex", avatarUrl: undefined },
      { id: "u-alex", displayName: "Legacy Link User", avatarUrl: undefined },
    ]);
  });

  it("skips mentions the lookup can't name", () => {
    const out = collectMentionIdentities(`@<${A}> @<${B}>`, lookup({}));
    expect(out).toEqual([]);
  });

  it("de-duplicates a repeated mention by normalized id", () => {
    // Two DIFFERENT raw forms of the same identity (entityId link form + dashed
    // `@<GUID>` token) collapse to one entry via normalizeIdentityGuid.
    const entity = "vss.ds.v1.ims.user.6b71186cc2e66813b4e0ffcd511163f4";
    const body = `[@s](mention://user/${entity}) @<${A}>`;
    const out = collectMentionIdentities(
      body,
      lookup({ [A]: { displayName: "S" } }),
    );
    expect(out).toEqual([{ id: A, displayName: "S", avatarUrl: undefined }]);
  });
});

describe("encodePickedMentions", () => {
  const A = "6b71186c-c2e6-6813-b4e0-ffcd511163f4";
  const B = "140e7feb-6e57-4d7b-8de6-474d9b9813db";

  it("returns text unchanged when there are no picks", () => {
    expect(encodePickedMentions("hi @Sam", [])).toBe("hi @Sam");
  });

  it("re-encodes a readable label to the ADO `@<GUID>` token", () => {
    const out = encodePickedMentions("cc @Shubham Dwivedi please", [
      { label: "Shubham Dwivedi", id: A },
    ]);
    expect(out).toBe(`cc @<${A}> please`);
  });

  it("encodes at end of string (no trailing char)", () => {
    expect(encodePickedMentions("ping @Ada", [{ label: "Ada", id: A }])).toBe(
      `ping @<${A}>`,
    );
  });

  it("prefers the longer label when one is a prefix of another", () => {
    const out = encodePickedMentions("hi @Sam Lee and @Sam", [
      { label: "Sam", id: A },
      { label: "Sam Lee", id: B },
    ]);
    expect(out).toBe(`hi @<${B}> and @<${A}>`);
  });

  it("does not fire inside a longer word or after a non-space char", () => {
    // `@Sam` must not match inside `@Sammy` (right boundary) or `email@Sam`
    // (left boundary — `@` not starting a word).
    expect(
      encodePickedMentions("@Sammy and email@Sam", [{ label: "Sam", id: A }]),
    ).toBe("@Sammy and email@Sam");
  });

  it("does not fire when followed by mention-friendly chars (_ . -)", () => {
    // detectActiveTrigger allows `_`, `.`, `-` inside mention text, so `@Sam`
    // must NOT be encoded inside `@Sam_Lee` / `@Sam.Lee` / `@Sam-Lee`.
    for (const suffix of ["_Lee", ".Lee", "-Lee"]) {
      expect(
        encodePickedMentions(`hi @Sam${suffix}`, [{ label: "Sam", id: A }]),
      ).toBe(`hi @Sam${suffix}`);
    }
    // But a true punctuation boundary still encodes.
    expect(
      encodePickedMentions("hi @Sam! done", [{ label: "Sam", id: A }]),
    ).toBe(`hi @<${A}>! done`);
  });

  it("leaves an edited (non-matching) label as typed", () => {
    expect(
      encodePickedMentions("@Shubh", [{ label: "Shubham Dwivedi", id: A }]),
    ).toBe("@Shubh");
  });

  it("skips picks with an empty label", () => {
    expect(encodePickedMentions("@Sam", [{ label: "", id: A }])).toBe("@Sam");
  });

  it("maps same-named-but-distinct people via disambiguated labels", () => {
    // Two different "Shubham Dwivedi" — the composer inserts unique labels
    // ("Shubham Dwivedi" and "Shubham Dwivedi 2"), so each encodes to its OWN
    // id rather than both collapsing to the first-picked id.
    const out = encodePickedMentions(
      "cc @Shubham Dwivedi and @Shubham Dwivedi 2",
      [
        { label: "Shubham Dwivedi", id: A },
        { label: "Shubham Dwivedi 2", id: B },
      ],
    );
    expect(out).toBe(`cc @<${A}> and @<${B}>`);
  });
});

describe("uniqueMentionLabel", () => {
  it("returns the base label when it's not taken", () => {
    expect(uniqueMentionLabel("Sam", [])).toBe("Sam");
    expect(uniqueMentionLabel("Sam", ["Alex"])).toBe("Sam");
  });

  it("appends the next free numeric suffix on collision", () => {
    expect(uniqueMentionLabel("Sam", ["Sam"])).toBe("Sam 2");
    expect(uniqueMentionLabel("Sam", ["Sam", "Sam 2"])).toBe("Sam 3");
  });

  it("skips gaps to the first free suffix", () => {
    // "Sam 2" is free even though "Sam 3" is taken.
    expect(uniqueMentionLabel("Sam", ["Sam", "Sam 3"])).toBe("Sam 2");
  });
});

describe("mergeMentionIdentities", () => {
  const A = "6b71186c-c2e6-6813-b4e0-ffcd511163f4";

  it("unions lists, first occurrence wins, de-duped by normalized id", () => {
    const out = mergeMentionIdentities(
      [{ id: A, displayName: "First" }],
      [
        { id: A.toUpperCase(), displayName: "Dupe" },
        { id: "u-alex", displayName: "Alex" },
      ],
    );
    expect(out).toEqual([
      { id: A, displayName: "First" },
      { id: "u-alex", displayName: "Alex" },
    ]);
  });

  it("returns an empty array for no lists", () => {
    expect(mergeMentionIdentities()).toEqual([]);
  });
});

describe("authorToUserSuggestion", () => {
  it("forwards id / displayName / initials / avatar", () => {
    const a: CommentAuthor = {
      id: "x",
      displayName: "Sam",
      initials: "SA",
      avatarUrl: "https://example.com/a.png",
    };
    expect(authorToUserSuggestion(a)).toEqual({
      kind: "user",
      id: "x",
      displayName: "Sam",
      initials: "SA",
      avatarUrl: "https://example.com/a.png",
    });
  });

  it("propagates undefined avatar correctly", () => {
    const a: CommentAuthor = { id: "x", displayName: "Sam", initials: "SA" };
    const s = authorToUserSuggestion(a);
    expect(s.avatarUrl).toBeUndefined();
  });
});

describe("normalizeIdentityGuid", () => {
  const DASHED = "6b71186c-c2e6-6813-b4e0-ffcd511163f4";

  it("lower-cases an already-dashed GUID", () => {
    expect(normalizeIdentityGuid(DASHED.toUpperCase())).toBe(DASHED);
  });

  it("inserts dashes into a bare 32-hex id and lower-cases it", () => {
    expect(normalizeIdentityGuid("6B71186CC2E66813B4E0FFCD511163F4")).toBe(
      DASHED,
    );
  });

  it("extracts the dashed GUID run from a `vss.ds…` entityId", () => {
    expect(
      normalizeIdentityGuid(
        "vss.ds.v1.ims.user.6b71186cc2e66813b4e0ffcd511163f4",
      ),
    ).toBe(DASHED);
  });

  it("returns undefined when no GUID can be found", () => {
    expect(normalizeIdentityGuid("nobody")).toBeUndefined();
    expect(normalizeIdentityGuid("")).toBeUndefined();
    expect(normalizeIdentityGuid(undefined)).toBeUndefined();
  });
});
