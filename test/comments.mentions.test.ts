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
    it.each([
        {
            name: "@ at the start of the input opens people",
            text: "@al",
            caret: 3,
            kind: "user",
            start: 0,
            query: "al",
        },
        {
            name: "# after a space opens work items",
            text: "hi #foo",
            caret: 7,
            kind: "workitem",
            start: 3,
            query: "foo",
        },
        {
            name: "! after a newline opens pull requests",
            text: "line1\n!42",
            caret: 9,
            kind: "pullrequest",
            start: 6,
            query: "42",
        },
        {
            name: "a lone @ opens people with an empty query",
            text: "@",
            caret: 1,
            kind: "user",
            start: 0,
            query: "",
        },
        {
            name: "spaces, dots, dashes and underscores stay part of the query",
            text: "@Alice An.der-son_",
            caret: 18,
            kind: "user",
            start: 0,
            query: "Alice An.der-son_",
        },
    ])("$name", ({ text, caret, kind, start, query }) => {
        expect(detectActiveTrigger(text, caret)).toEqual({
            kind,
            char: text[start],
            start,
            end: caret,
            query,
        });
    });

    it.each([
        { name: "there is no trigger before the caret", text: "hello there", caret: 11 },
        { name: "the @ belongs to an email address", text: "me@example", caret: 10 },
        { name: "the # is glued to a word", text: "hello#tag", caret: 9 },
        { name: "punctuation already closed the mention", text: "@alice, hi", caret: 10 },
        {
            name: "the trigger is more than 64 characters back",
            text: `@${"a".repeat(80)}`,
            caret: 81,
        },
        // A stale caret (the text shrank after the caret was read) must not open the picker.
        { name: "the caret is before the text", text: "hello", caret: -1 },
        { name: "the caret is past the end of the text", text: "@ab", caret: 4 },
    ])("keeps the picker closed when $name", ({ text, caret }) => {
        expect(detectActiveTrigger(text, caret)).toBeNull();
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
    it.each([
        ["an ordinary web link", "https://example.com"],
        ["a script URL", "javascript:alert(1)"],
        ["an empty URL", ""],
        ["a mention of an unknown kind", "mention://group/42"],
        ["a mention with no id segment", "mention://user"],
    ])("does not treat %s as a mention", (_label, url) => {
        expect(parseMentionUrl(url)).toBeNull();
    });

    it("decodes a user mention with no params", () => {
        expect(parseMentionUrl("mention://user/user-abc")).toEqual({
            kind: "user",
            id: "user-abc",
            params: {},
        });
    });

    it("decodes a workitem mention with query params", () => {
        expect(parseMentionUrl("mention://workitem/123?type=Bug&state=Active")).toEqual({
            kind: "workitem",
            id: "123",
            params: { type: "Bug", state: "Active" },
        });
    });

    // User mentions persist as the ADO-native `@<GUID>` token (covered by
    // preprocessUserMentions), so only work item / PR mentions are link-shaped.
    it.each([
        ["work item", WI],
        ["pull request", PR],
    ] satisfies Array<[string, MentionSuggestion]>)(
        "reads back the %s a picked mention link points at",
        (_label, suggestion) => {
            const url = /\]\((mention:\/\/[^)]+)\)/.exec(buildMentionMarkdown(suggestion))![1]!;

            expect(parseMentionUrl(url)).toMatchObject({
                kind: suggestion.kind,
                id: suggestion.id,
            });
        },
    );

    it("decodes percent-encoded ids", () => {
        expect(parseMentionUrl("mention://user/foo%20bar")).toEqual({
            kind: "user",
            id: "foo bar",
            params: {},
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

    it.each([
        ["an email address and a bare @word", "email <a@b.com> and @notaguid"],
        ["an @<...> token that is not a GUID", "@<not-a-guid>"],
    ])("leaves %s untouched", (_label, text) => {
        expect(preprocessUserMentions(text)).toBe(text);
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

    it("keeps the raw link id when its percent-encoding is malformed", () => {
        expect(collectUserMentionIds("[@x](mention://user/a%E0%A4b)")).toEqual(["a%E0%A4b"]);
    });

    it("returns an empty array when there are no mentions", () => {
        expect(collectUserMentionIds("just prose, no mentions")).toEqual([]);
    });
});

describe("collectMentionIdentities", () => {
    const A = "6b71186c-c2e6-6813-b4e0-ffcd511163f4";
    const B = "140e7feb-6e57-4d7b-8de6-474d9b9813db";

    const lookup =
        (map: Record<string, { displayName: string; avatarUrl?: string }>) => (id: string) =>
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
            {
                id: "u-alex",
                displayName: "Legacy Link User",
                avatarUrl: undefined,
            },
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

        const out = collectMentionIdentities(body, lookup({ [A]: { displayName: "S" } }));

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
        expect(encodePickedMentions("ping @Ada", [{ label: "Ada", id: A }])).toBe(`ping @<${A}>`);
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
        expect(encodePickedMentions("@Sammy and email@Sam", [{ label: "Sam", id: A }])).toBe(
            "@Sammy and email@Sam",
        );
    });

    // detectActiveTrigger allows `_`, `.`, `-` inside mention text, so `@Sam`
    // is a different, longer mention there.
    it.each(["_Lee", ".Lee", "-Lee"])("does not encode @Sam inside @Sam%s", (suffix) => {
        expect(encodePickedMentions(`hi @Sam${suffix}`, [{ label: "Sam", id: A }])).toBe(
            `hi @Sam${suffix}`,
        );
    });

    it("encodes a mention followed by ordinary punctuation", () => {
        expect(encodePickedMentions("hi @Sam! done", [{ label: "Sam", id: A }])).toBe(
            `hi @<${A}>! done`,
        );
    });

    it("leaves an edited (non-matching) label as typed", () => {
        expect(encodePickedMentions("@Shubh", [{ label: "Shubham Dwivedi", id: A }])).toBe(
            "@Shubh",
        );
    });

    it("skips picks with an empty label", () => {
        expect(encodePickedMentions("@Sam", [{ label: "", id: A }])).toBe("@Sam");
    });

    it("maps same-named-but-distinct people via disambiguated labels", () => {
        // Two different "Shubham Dwivedi" — the composer inserts unique labels
        // ("Shubham Dwivedi" and "Shubham Dwivedi 2"), so each encodes to its OWN
        // id rather than both collapsing to the first-picked id.
        const out = encodePickedMentions("cc @Shubham Dwivedi and @Shubham Dwivedi 2", [
            { label: "Shubham Dwivedi", id: A },
            { label: "Shubham Dwivedi 2", id: B },
        ]);

        expect(out).toBe(`cc @<${A}> and @<${B}>`);
    });
});

describe("uniqueMentionLabel", () => {
    // Two different people with the same name must get distinct labels in one
    // comment so each encodes to its own id.
    it.each([
        { name: "keeps the name when nobody else is mentioned", taken: [], label: "Sam" },
        { name: "keeps the name when only others are mentioned", taken: ["Alex"], label: "Sam" },
        { name: "numbers a second person with the same name", taken: ["Sam"], label: "Sam 2" },
        {
            name: "numbers a third person after the second",
            taken: ["Sam", "Sam 2"],
            label: "Sam 3",
        },
        { name: "reuses the first free number", taken: ["Sam", "Sam 3"], label: "Sam 2" },
    ])("$name", ({ taken, label }) => {
        expect(uniqueMentionLabel("Sam", taken)).toBe(label);
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
    it("offers a comment author as a person to mention", () => {
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
});

// ADO hands out the same identity in several shapes; they must all collapse to
// one key so a person is recognised however a mention or author refers to them.
describe("normalizeIdentityGuid", () => {
    const DASHED = "6b71186c-c2e6-6813-b4e0-ffcd511163f4";

    it.each([
        ["an upper-case dashed GUID", DASHED.toUpperCase()],
        ["a bare 32-hex id", "6B71186CC2E66813B4E0FFCD511163F4"],
        ["an identity picker entityId", "vss.ds.v1.ims.user.6b71186cc2e66813b4e0ffcd511163f4"],
    ])("normalizes %s to the lower-case dashed GUID", (_label, raw) => {
        expect(normalizeIdentityGuid(raw)).toBe(DASHED);
    });

    it.each([
        ["a plain name", "nobody"],
        ["an empty id", ""],
        ["a missing id", undefined],
    ])("finds no GUID in %s", (_label, raw) => {
        expect(normalizeIdentityGuid(raw)).toBeUndefined();
    });
});
