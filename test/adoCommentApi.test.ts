// Tests for the small pure helpers exported from
// `src/pr-tab/adoCommentApi.ts`. We don't talk to the SDK here — those
// paths require a host iframe and are covered by manual / e2e testing.

import { describe, expect, it } from "vitest";

import {
    adoThreadToLocal,
    buildThreadContext,
    buildWorkItemWiql,
    buildIdentitiesUrl,
    collectThreadIdentities,
    editedAtOf,
    fileDiffCacheReplacer,
    fromAdoStatus,
    hashString,
    initialsOf,
    normalizeIdentityGuid,
    lineDiffBlocksToCounts,
    lineDiffBlocksToRanges,
    parseIdentitiesResponse,
    pathsRequiringOriginalSource,
    pickerAvatarUrl,
    matchPullRequestSuggestions,
    prStatusLabel,
    readMentionsProp,
    readProp,
    WORK_ITEM_TITLE_LOOKBACK_DAYS,
} from "../src/shell/adoCommentApi.helpers";
import { identityAvatarUrl } from "../src/shell/adoGitData.helpers";
import { withBackLink } from "../src/shell/backLink";

// Numeric runtime values of `PullRequestStatus` (kept in-test so we don't
// need to import the SDK enum, which uses an AMD bundle Node can't load).
const PR_STATUS = {
    NotSet: 0,
    Active: 1,
    Abandoned: 2,
    Completed: 3,
    All: 4,
} as const;

describe("pickerAvatarUrl", () => {
    const ID = "6b71186c-c2e6-6813-b4e0-ffcd511163f4";

    const SELF = "https://dev.azure.com/contoso/_apis/GraphProfile/MemberAvatars/aad.self";

    it("rebuilds the CORS-safe identityImage URL off the org base when the identity has a photo", () => {
        // The identity's OWN image is a host-relative MemberAvatars URL; only its
        // presence matters — the URL is rebuilt from the id + the current user's
        // (absolute) org base, so it can't resolve against the iframe origin.
        expect(
            pickerAvatarUrl(ID, "/contoso/_apis/GraphProfile/MemberAvatars/aad.other", SELF),
        ).toBe(`https://dev.azure.com/contoso/_api/_common/identityImage?id=${ID}`);
    });

    it.each([undefined, ""])("shows initials for an identity without a photo (%j)", (photo) => {
        expect(pickerAvatarUrl(ID, photo, SELF)).toBeUndefined();
    });

    it("returns undefined when there is no org base to borrow", () => {
        expect(
            pickerAvatarUrl(ID, "/x/_apis/GraphProfile/MemberAvatars/aad.other", undefined),
        ).toBeUndefined();
    });
});

describe("readProp", () => {
    it.each([null, "nope"])("reads nothing from the non-object properties %j", (container) => {
        expect(readProp(container, "k")).toBeUndefined();
    });

    it.each([
        ["absent", { other: 1 }],
        ["null", { k: null }],
    ])("returns undefined when the key is %s", (_state, properties) => {
        expect(readProp(properties, "k")).toBeUndefined();
    });

    it("unwraps the ADO `$value` envelope", () => {
        expect(readProp({ k: { $value: "wrapped" } }, "k")).toBe("wrapped");
    });

    it("returns a plain (unwrapped) value as-is", () => {
        expect(readProp({ k: "plain" }, "k")).toBe("plain");
    });
});

describe("hashString", () => {
    it("returns a 32-bit unsigned hex string", () => {
        const h = hashString("hello");
        expect(h).toMatch(/^[0-9a-f]+$/);
        expect(parseInt(h, 16)).toBeLessThan(2 ** 32);
    });

    it("is deterministic — same input ⇒ same output", () => {
        expect(hashString("abc")).toBe(hashString("abc"));
    });

    it("returns a different hash for different inputs (probabilistically)", () => {
        expect(hashString("abc")).not.toBe(hashString("abd"));
    });
});

describe("file diff cache privacy", () => {
    it("omits complete original source while preserving diff metadata", () => {
        const serialized = JSON.stringify(
            {
                "/guide.md": {
                    linesAdded: 1,
                    linesDeleted: 1,
                    originalSource: "complete base document",
                    ranges: [{ kind: "modified", originalText: "changed line" }],
                },
            },
            fileDiffCacheReplacer,
        );

        expect(serialized).not.toContain("complete base document");
        expect(serialized).toContain("changed line");
    });

    it("rehydrates only deletion-bearing entries missing original source", () => {
        expect(
            pathsRequiringOriginalSource({
                "/missing.md": { linesDeleted: 1 },
                "/present.md": { linesDeleted: 1, originalSource: "base" },
                "/added.md": { linesDeleted: 0 },
            }),
        ).toEqual(["/missing.md"]);
    });
});

describe("buildWorkItemWiql", () => {
    it("uses `id =` when the query is purely numeric, at any age and length", () => {
        expect(buildWorkItemWiql("42")).toBe(
            "SELECT [System.Id] FROM WorkItems WHERE [System.Id] = 42",
        );
        expect(buildWorkItemWiql("7")).toBe(
            "SELECT [System.Id] FROM WorkItems WHERE [System.Id] = 7",
        );
    });

    // Production: the unscoped title search timed out (VS402335) in large orgs.
    it("searches recent titles in this project only", () => {
        expect(buildWorkItemWiql("login bug")).toBe(
            "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project " +
                `AND [System.ChangedDate] >= @Today - ${WORK_ITEM_TITLE_LOOKBACK_DAYS} ` +
                "AND [System.Title] CONTAINS 'login bug' ORDER BY [System.ChangedDate] DESC",
        );
    });

    it.each(["", "a"])("skips a title query too short to search (%j)", (query) => {
        expect(buildWorkItemWiql(query)).toBeNull();
    });

    it.each(["Sprint 12", "2fa login"])(
        "searches titles for a query mixing words and numbers (%j)",
        (query) => {
            expect(buildWorkItemWiql(query)).toContain(`[System.Title] CONTAINS '${query}'`);
        },
    );

    it("escapes single quotes in the user-supplied query", () => {
        const q = buildWorkItemWiql("can't log in");
        expect(q).toContain("[System.Title] CONTAINS 'can''t log in'");
    });
});

describe("prStatusLabel", () => {
    it.each([
        { name: "Completed", status: PR_STATUS.Completed, label: "completed" },
        { name: "Abandoned", status: PR_STATUS.Abandoned, label: "abandoned" },
        { name: "Active", status: PR_STATUS.Active, label: "active" },
        { name: "NotSet", status: PR_STATUS.NotSet, label: "active" },
        { name: "a missing status", status: undefined, label: "active" },
    ])("labels a PR with $name as $label", ({ status, label }) => {
        expect(prStatusLabel(status as never)).toBe(label);
    });
});

describe("matchPullRequestSuggestions", () => {
    const pr = (pullRequestId: number | undefined, title?: string) => ({
        pullRequestId,
        title,
        status: PR_STATUS.Active as never,
        repository: { name: "docs" } as never,
    });

    it("matches a numeric query by exact id, regardless of title", () => {
        const ids = matchPullRequestSuggestions(
            [pr(41, "Other"), pr(42, "Unrelated"), pr(420, "Also other")],
            "42",
        ).map((s) => s.id);

        expect(ids).toEqual(["42"]);
    });

    it("matches titles case-insensitively, including digits in a title", () => {
        const ids = matchPullRequestSuggestions(
            [pr(1, "Fix API v42 docs"), pr(2, "Polish the API"), pr(3, "Unrelated")],
            "api",
        ).map((s) => s.id);

        expect(ids).toEqual(["1", "2"]);
    });

    it("finds a PR by its number typed with surrounding spaces", () => {
        expect(
            matchPullRequestSuggestions([pr(41, "Other"), pr(42, "Unrelated")], " 42 ").map(
                (s) => s.id,
            ),
        ).toEqual(["42"]);
    });

    it("matches a numeric query against digits in a title", () => {
        expect(matchPullRequestSuggestions([pr(7, "Bump to v42")], "42").map((s) => s.id)).toEqual([
            "7",
        ]);
    });

    it("skips entries without a numeric id instead of suggesting `undefined`", () => {
        const suggestions = matchPullRequestSuggestions(
            [pr(undefined, "Docs refresh"), pr(6), pr(5, "Docs cleanup")],
            "docs",
        );

        expect(suggestions.map((s) => s.id)).toEqual(["5"]);
    });

    it("returns at most 10 suggestions, in input order", () => {
        const prs = Array.from({ length: 12 }, (_, i) => pr(i + 1, "Docs"));
        const ids = matchPullRequestSuggestions(prs, "docs").map((s) => s.id);
        expect(ids).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    });

    it("suggests a PR with its id, title, status and repository", () => {
        expect(matchPullRequestSuggestions([pr(9, "Docs")], "docs")).toEqual([
            {
                kind: "pullrequest",
                id: "9",
                title: "Docs",
                status: "active",
                repository: "docs",
            },
        ]);
    });

    it("suggests a PR without a title or repository with placeholders", () => {
        expect(
            matchPullRequestSuggestions(
                [{ pullRequestId: 8, status: PR_STATUS.Completed as never }],
                "8",
            ),
        ).toEqual([
            {
                kind: "pullrequest",
                id: "8",
                title: "(untitled PR)",
                status: "completed",
                repository: undefined,
            },
        ]);
    });
});

describe("initialsOf", () => {
    it("handles a single word by taking the first two letters", () => {
        expect(initialsOf("Alice")).toBe("AL");
    });

    it.each([
        ["Alice Anderson", "AA"],
        ["  Sam   B  Carter  ", "SC"],
    ])("takes the first and last initials of the multi-word name %j", (name, initials) => {
        expect(initialsOf(name)).toBe(initials);
    });

    it.each(["", "   "])("shows `?` for the blank name %j", (name) => {
        expect(initialsOf(name)).toBe("?");
    });

    it("uppercases the result", () => {
        expect(initialsOf("jane doe")).toBe("JD");
    });
});

describe("normalizeIdentityGuid", () => {
    const GUID = "6b71186c-c2e6-6813-b4e0-ffcd511163f4";

    it("returns a dashed GUID lower-cased as-is", () => {
        expect(normalizeIdentityGuid(GUID.toUpperCase())).toBe(GUID);
    });

    it("inserts dashes into a bare 32-hex id", () => {
        expect(normalizeIdentityGuid("6b71186cc2e66813b4e0ffcd511163f4")).toBe(GUID);
    });

    it("extracts the GUID from the picker's `vss.ds…` entityId form", () => {
        expect(normalizeIdentityGuid("vss.ds.v1.ims.user.6b71186cc2e66813b4e0ffcd511163f4")).toBe(
            GUID,
        );
    });

    it.each(["no-guid-here", undefined, ""])("finds no GUID in %j", (id) => {
        expect(normalizeIdentityGuid(id)).toBeUndefined();
    });
});

describe("buildIdentitiesUrl", () => {
    const A = "08538e47-5e28-6ce6-9c31-f3f9b23418fb";
    const B = "6b71186c-c2e6-6813-b4e0-ffcd511163f4";

    it("builds a vssps identities URL scoped to the org, lookup by id", () => {
        expect(buildIdentitiesUrl("contoso", [A, B])).toBe(
            `https://vssps.dev.azure.com/contoso/_apis/identities?identityIds=${A},${B}&api-version=7.1-preview.1`,
        );
    });

    it("lower-cases, trims, and de-dupes ids", () => {
        expect(buildIdentitiesUrl("org", [` ${A.toUpperCase()} `, A])).toBe(
            `https://vssps.dev.azure.com/org/_apis/identities?identityIds=${A}&api-version=7.1-preview.1`,
        );
    });

    it("url-encodes the org name", () => {
        expect(buildIdentitiesUrl("my org", [A])).toContain(
            "https://vssps.dev.azure.com/my%20org/_apis/identities",
        );
    });

    it.each([
        { name: "an org", org: undefined, ids: [A] },
        { name: "an org name", org: "", ids: [A] },
        { name: "any ids", org: "org", ids: [] },
        { name: "any non-blank ids", org: "org", ids: ["", "   "] },
    ])("has no lookup URL without $name", ({ org, ids }) => {
        expect(buildIdentitiesUrl(org, ids)).toBeNull();
    });
});

describe("parseIdentitiesResponse", () => {
    const A = "08538e47-5e28-6ce6-9c31-f3f9b23418fb";
    const B = "6b71186c-c2e6-6813-b4e0-ffcd511163f4";

    it("maps requested ids to display names (case-insensitively)", () => {
        const body = {
            count: 2,
            value: [
                { id: A.toUpperCase(), providerDisplayName: "Ada Lovelace" },
                { id: B, providerDisplayName: "Alan Turing" },
            ],
        };

        expect(parseIdentitiesResponse(body, [A, B])).toEqual({
            [A]: { displayName: "Ada Lovelace" },
            [B]: { displayName: "Alan Turing" },
        });
    });

    it("prefers providerDisplayName, falling back to customDisplayName", () => {
        const body = {
            value: [{ id: A, customDisplayName: "Custom Name" }],
        };

        expect(parseIdentitiesResponse(body, [A])).toEqual({
            [A]: { displayName: "Custom Name" },
        });
    });

    it("keys each name by the id exactly as it was requested", () => {
        const body = { value: [{ id: A, providerDisplayName: "Ada Lovelace" }] };
        expect(parseIdentitiesResponse(body, [` ${A.toUpperCase()} `])).toEqual({
            [` ${A.toUpperCase()} `]: { displayName: "Ada Lovelace" },
        });
    });

    it("omits ids the service didn't return (no wrong-person fallback)", () => {
        const body = { value: [{ id: B, providerDisplayName: "Alan Turing" }] };
        expect(parseIdentitiesResponse(body, [A])).toEqual({});
    });

    it("ignores entries missing an id or a name", () => {
        const body = {
            value: [{ providerDisplayName: "No Id" }, { id: A, providerDisplayName: "" }],
        };

        expect(parseIdentitiesResponse(body, [A])).toEqual({});
    });

    it("skips null slots (unresolvable ids) without dropping resolved ones", () => {
        // ADO returns `null` in the value array for any requested id it can't
        // resolve (e.g. a cross-tenant AAD guest queried by object id). A single
        // null must not crash the batch and lose the ids that DID resolve.
        const body = {
            count: 2,
            value: [{ id: A, providerDisplayName: "Ada Lovelace" }, null],
        };

        expect(parseIdentitiesResponse(body, [A, B])).toEqual({
            [A]: { displayName: "Ada Lovelace" },
        });
    });

    it.each([
        { name: "no body", body: null },
        { name: "a body without a value list", body: {} },
        { name: "a value that is not a list", body: { value: "nope" } },
    ])("resolves nobody from a malformed response with $name", ({ body }) => {
        expect(parseIdentitiesResponse(body, [A])).toEqual({});
    });
});

// ---------------------------------------------------------------------------
// adoThreadToLocal — provenance bucketing
// ---------------------------------------------------------------------------

// Minimal thread/comment builders. We only set the fields the converter
// reads; everything else is cast away. CommentType: Text=1, System=3.
function comment(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 1,
        commentType: 1,
        isDeleted: false,
        content: "hello",
        author: { id: "u1", displayName: "Ada Lovelace" },
        publishedDate: new Date("2024-01-01T00:00:00Z"),
        ...over,
    };
}

function thread(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 100,
        status: 1 /* Active */,
        isDeleted: false,
        comments: [comment()],
        ...over,
    };
}

const conv = (t: Record<string, unknown>) => adoThreadToLocal(t as any);

describe("readMentionsProp", () => {
    const wrap = (value: string) => ({
        emrMentions: { $type: "System.String", $value: value },
    });

    it("parses a valid JSON array of identities", () => {
        const out = readMentionsProp(
            wrap(JSON.stringify([{ id: "a", displayName: "A", avatarUrl: "x" }])),
        );

        expect(out).toEqual([{ id: "a", displayName: "A", avatarUrl: "x" }]);
    });

    it("coerces a non-string avatarUrl to undefined", () => {
        const out = readMentionsProp(
            wrap(JSON.stringify([{ id: "a", displayName: "A", avatarUrl: 5 }])),
        );

        expect(out).toEqual([{ id: "a", displayName: "A", avatarUrl: undefined }]);
    });

    it("skips entries missing id or displayName", () => {
        const out = readMentionsProp(
            wrap(
                JSON.stringify([
                    { id: "a" },
                    null,
                    { displayName: "B" },
                    { id: "c", displayName: "C" },
                ]),
            ),
        );

        expect(out).toEqual([{ id: "c", displayName: "C", avatarUrl: undefined }]);
    });

    it.each([
        { name: "no properties", props: undefined },
        { name: "a blank value", props: wrap("") },
        { name: "malformed JSON", props: wrap("{not json") },
        { name: "a non-array value", props: wrap(JSON.stringify({ not: "array" })) },
    ])("reads no mentions from $name", ({ props }) => {
        expect(readMentionsProp(props)).toEqual([]);
    });
});

describe("collectThreadIdentities", () => {
    const GUID = "6b71186c-c2e6-6813-b4e0-ffcd511163f4";

    const call = (t: Record<string, unknown>) => collectThreadIdentities(t as any);

    it("extracts ADO-resolved mention identities (name + avatar)", () => {
        const out = call(
            thread({
                identities: {
                    "1": {
                        id: GUID,
                        displayName: "Shubham Dwivedi",
                        imageUrl: "https://ado/avatar",
                    },
                },
            }),
        );

        expect(out).toEqual([
            {
                id: GUID,
                displayName: "Shubham Dwivedi",
                avatarUrl: "https://ado/avatar",
            },
        ]);
    });

    it("normalizes an entityId-form id to the dashed GUID", () => {
        const out = call(
            thread({
                identities: {
                    "1": {
                        id: "vss.ds.v1.ims.user.6b71186cc2e66813b4e0ffcd511163f4",
                        displayName: "Shubham Dwivedi",
                    },
                },
            }),
        );

        expect(out[0]!.id).toBe(GUID);
    });

    it("skips entries without an id or a display name, and null entries", () => {
        const out = call(
            thread({
                identities: {
                    "1": { displayName: "No Id" },
                    "2": { id: GUID, displayName: "" },
                    "3": null,
                    // Malformed refs whose id or name isn't text.
                    "4": { id: GUID, displayName: 42 },
                    "5": { id: 42, displayName: "Numeric Id" },
                },
            }),
        );

        expect(out).toEqual([]);
    });

    it("drops an avatar that isn't a URL", () => {
        const out = call(
            thread({ identities: { "1": { id: GUID, displayName: "Ada", imageUrl: 7 } } }),
        );

        expect(out).toEqual([{ id: GUID, displayName: "Ada", avatarUrl: undefined }]);
    });

    it("keeps an identity whose id isn't a GUID (e.g. a service account) as-is", () => {
        const out = call(
            thread({
                identities: {
                    "1": { id: "svc-account", displayName: "Service" },
                },
            }),
        );

        expect(out).toEqual([{ id: "svc-account", displayName: "Service", avatarUrl: undefined }]);
    });

    it.each([
        { name: "has no identities map", over: {} },
        { name: "has a null identities map", over: { identities: null } },
    ])("collects nobody when the thread $name", ({ over }) => {
        expect(call(thread(over))).toEqual([]);
    });
});

describe("adoThreadToLocal", () => {
    it("returns null for a deleted thread", () => {
        expect(conv(thread({ isDeleted: true }))).toBeNull();
    });
    it("returns null when every comment is deleted or system", () => {
        expect(
            conv(
                thread({
                    comments: [
                        comment({ isDeleted: true }),
                        comment({ commentType: 3 /* System */ }),
                    ],
                }),
            ),
        ).toBeNull();
    });

    it("filters out system comments but keeps real discussion", () => {
        const local = conv(
            thread({
                comments: [comment({ commentType: 3 }), comment({ id: 2 })],
            }),
        );

        expect(local).not.toBeNull();
        expect(local!.comments).toHaveLength(1);
        expect(local!.comments[0]!.id).toBe("2");
    });

    it("maps `usersLiked` into a single 'like' reaction with those users", () => {
        const local = conv(
            thread({
                comments: [
                    comment({
                        usersLiked: [
                            { id: "u1", displayName: "User One" },
                            { id: "u2", displayName: "User Two" },
                        ],
                    }),
                ],
            }),
        );

        expect(local!.comments[0]!.reactions).toEqual([
            {
                kind: "like",
                users: [
                    { id: "u1", displayName: "User One" },
                    { id: "u2", displayName: "User Two" },
                ],
            },
        ]);
    });

    it("falls back to the id when a liker has no display name", () => {
        const local = conv(
            thread({
                comments: [comment({ usersLiked: [{ id: "u9" }] })],
            }),
        );

        expect(local!.comments[0]!.reactions).toEqual([
            { kind: "like", users: [{ id: "u9", displayName: "u9" }] },
        ]);
    });

    it("omits reactions when nobody liked the comment", () => {
        const local = conv(thread({ comments: [comment({ usersLiked: [] })] }));
        expect(local!.comments[0]!.reactions).toBeUndefined();
    });

    it("attaches ADO-resolved mention identities to the local thread", () => {
        const GUID = "6b71186c-c2e6-6813-b4e0-ffcd511163f4";

        const local = conv(
            thread({
                identities: {
                    "1": { id: GUID, displayName: "Shubham Dwivedi" },
                },
            }),
        );

        expect(local!.mentionedIdentities).toEqual([
            { id: GUID, displayName: "Shubham Dwivedi", avatarUrl: undefined },
        ]);
    });

    it("omits mentionedIdentities when the thread has no identities", () => {
        const local = conv(thread());
        expect(local!.mentionedIdentities).toBeUndefined();
    });

    it("reads mention names WE persisted from the emrMentions property", () => {
        const GUID = "140e7feb-6e57-4d7b-8de6-474d9b9813db";

        const local = conv(
            thread({
                properties: {
                    emrMentions: {
                        $type: "System.String",
                        $value: JSON.stringify([
                            {
                                id: GUID,
                                displayName: "Cross-Tenant Guest",
                                avatarUrl: "g",
                            },
                        ]),
                    },
                },
            }),
        );

        expect(local!.mentionedIdentities).toEqual([
            { id: GUID, displayName: "Cross-Tenant Guest", avatarUrl: "g" },
        ]);
    });

    it("prefers our emrMentions names and unions ADO's thread.identities", () => {
        const OURS = "140e7feb-6e57-4d7b-8de6-474d9b9813db";
        const ADO = "6b71186c-c2e6-6813-b4e0-ffcd511163f4";

        const local = conv(
            thread({
                identities: { "1": { id: ADO, displayName: "Org Account" } },
                properties: {
                    emrMentions: {
                        $type: "System.String",
                        $value: JSON.stringify([{ id: OURS, displayName: "Guest" }]),
                    },
                },
            }),
        );

        expect(local!.mentionedIdentities).toEqual([
            { id: OURS, displayName: "Guest", avatarUrl: undefined },
            { id: ADO, displayName: "Org Account", avatarUrl: undefined },
        ]);
    });

    it("falls back to the current time when a comment has no publishedDate", () => {
        const before = Date.now();

        const local = conv(thread({ comments: [comment({ publishedDate: undefined })] }));

        const created = Date.parse(local!.comments[0]!.createdAt);
        // The synthesized timestamp is a valid ISO date at/after the call start.
        expect(Number.isNaN(created)).toBe(false);
        expect(created).toBeGreaterThanOrEqual(before - 1000);
    });

    it("defaults author id/displayName when the comment has no author", () => {
        const local = conv(thread({ comments: [comment({ author: undefined })] }));

        expect(local!.comments[0]!.author).toMatchObject({
            id: "unknown",
            displayName: "Unknown",
        });
    });

    it("rewrites a fetched author's imageUrl to the CORS-safe identityImage endpoint", () => {
        // Regression: ADO returns the MemberAvatars URL on fetched comment authors,
        // which is CORS-blocked from the iframe and silently falls back to initials
        // — diverging from the freshly-posted (optimistic) author who already uses
        // the identityImage endpoint. authorFromAdo must normalize both to the same
        // URL so the same person renders their photo everywhere.
        const local = conv(
            thread({
                comments: [
                    comment({
                        author: {
                            id: "u9",
                            displayName: "Grace Hopper",
                            imageUrl:
                                "https://dev.azure.com/contoso/_apis/GraphProfile/MemberAvatars/aad.xyz",
                        },
                    }),
                ],
            }),
        );

        expect(local!.comments[0]!.author.avatarUrl).toBe(
            "https://dev.azure.com/contoso/_api/_common/identityImage?id=u9",
        );
    });

    it("matches the current-user avatar path exactly for the same identity", () => {
        // The fetched-author URL and the optimistic current-user URL must be byte-
        // for-byte identical so a person never renders a photo in one place and
        // initials in another.
        const identity = {
            id: "shared-id",
            imageUrl: "https://dev.azure.com/contoso/_apis/GraphProfile/MemberAvatars/aad.abc",
        };

        const local = conv(
            thread({
                comments: [
                    comment({
                        author: { ...identity, displayName: "Shared Person" },
                    }),
                ],
            }),
        );

        expect(local!.comments[0]!.author.avatarUrl).toBe(identityAvatarUrl(identity));
    });

    it("leaves avatarUrl undefined when a fetched author has no imageUrl", () => {
        const local = conv(
            thread({
                comments: [comment({ author: { id: "u2", displayName: "No Photo" } })],
            }),
        );

        expect(local!.comments[0]!.author.avatarUrl).toBeUndefined();
    });

    it("defaults bodyMarkdown to empty when the comment has no content", () => {
        const local = conv(thread({ comments: [comment({ content: undefined })] }));

        expect(local!.comments[0]!.bodyMarkdown).toBe("");
    });

    it("shows a comment without the back link ADO's comment UI shows", () => {
        const content = withBackLink(
            "Can we split this?",
            "https://dev.azure.com/org/Proj/_apps/hub/pub.ext.documents-hub?path=a.md",
        );

        const local = conv(thread({ comments: [comment({ content })] }));

        expect(local!.comments[0]!.bodyMarkdown).toBe("Can we split this?");
    });

    it("returns null when the thread has no comments array at all", () => {
        expect(conv(thread({ comments: undefined }))).toBeNull();
    });

    it("bucket 1: extension thread without threadContext gets an empty filePath", () => {
        const anchor = { exact: "world", prefix: "", suffix: "" };

        const local = conv(
            thread({
                properties: {
                    emrSchema: { $value: "1" },
                    emrAnchor: { $value: JSON.stringify(anchor) },
                },
            }),
        );

        expect(local!.origin).toBe("extension");
        expect(local!.filePath).toBe("");
        expect(local!.anchor).toEqual(anchor);
        expect(local).not.toHaveProperty("linkKey");
    });

    it.each([
        { name: "a key", value: "k-0123456789ab", linkKey: "k-0123456789ab" },
        { name: "a blank key", value: "", linkKey: undefined },
    ])("bucket 1: reads $name its back link names the thread by", ({ value, linkKey }) => {
        const local = conv(
            thread({
                properties: {
                    emrSchema: { $value: "1" },
                    emrAnchor: { $value: JSON.stringify({ exact: "w", prefix: "", suffix: "" }) },
                    emrLinkKey: { $value: value },
                },
            }),
        );

        expect(local!.linkKey).toBe(linkKey);
    });

    it("surfaces lastContentUpdatedDate as the comment's updatedAt", () => {
        const local = conv(
            thread({
                comments: [
                    comment({
                        lastContentUpdatedDate: new Date("2024-03-04T05:06:07Z"),
                    }),
                ],
            }),
        );

        expect(local!.comments[0]!.updatedAt).toBe("2024-03-04T05:06:07.000Z");
    });

    it("does NOT mark a comment edited when it was updated at publish time", () => {
        // ADO stamps `lastContentUpdatedDate` on creation too — equal to
        // `publishedDate`. That must NOT surface as an "edited" tag.
        const published = new Date("2024-01-01T00:00:00Z");

        const local = conv(
            thread({
                comments: [
                    comment({
                        publishedDate: published,
                        lastContentUpdatedDate: published,
                    }),
                ],
            }),
        );

        expect(local!.comments[0]!.updatedAt).toBeUndefined();
    });

    it("does NOT mark edited for sub-second clock skew at creation", () => {
        const local = conv(
            thread({
                comments: [
                    comment({
                        publishedDate: new Date("2024-01-01T00:00:00.000Z"),
                        lastContentUpdatedDate: new Date("2024-01-01T00:00:00.500Z"),
                    }),
                ],
            }),
        );

        expect(local!.comments[0]!.updatedAt).toBeUndefined();
    });

    it("bucket 1: extension-authored thread keeps its text-quote anchor", () => {
        const anchor = { exact: "world", prefix: "hello ", suffix: "!" };

        const local = conv(
            thread({
                properties: {
                    emrSchema: { $value: "1" },
                    emrAnchor: { $value: JSON.stringify(anchor) },
                },
                threadContext: { filePath: "/docs/a.md" },
            }),
        );

        expect(local!.origin).toBe("extension");
        expect(local!.filePath).toBe("/docs/a.md");
        expect(local!.anchor).toEqual(anchor);
        expect(local!.general).toBeUndefined();
    });

    it.each([
        { name: "malformed anchor JSON", schema: "1", anchor: "{not valid json" },
        { name: "a non-text anchor", schema: "1", anchor: 5 },
        {
            name: "an anchor from another schema version",
            schema: "2",
            anchor: JSON.stringify({ exact: "world", prefix: "", suffix: "" }),
        },
    ])("bucket 1: $name falls through to native handling", ({ schema, anchor }) => {
        const local = conv(
            thread({
                properties: {
                    emrSchema: { $value: schema },
                    emrAnchor: { $value: anchor },
                },
                threadContext: {
                    filePath: "/docs/a.md",
                    rightFileStart: { line: 7 },
                    rightFileEnd: { line: 7 },
                },
            }),
        );

        expect(local!.origin).toBe("ado");
        expect(local!.anchor.line).toBe(7);
    });

    it("bucket 2: native diff thread synthesizes a line anchor", () => {
        const local = conv(
            thread({
                threadContext: {
                    filePath: "/docs/a.md",
                    rightFileStart: { line: 3, offset: 1 },
                    rightFileEnd: { line: 5, offset: 10 },
                },
            }),
        );

        expect(local!.origin).toBe("ado");
        expect(local!.filePath).toBe("/docs/a.md");
        expect(local!.anchor).toEqual({
            exact: "",
            prefix: "",
            suffix: "",
            line: 3,
            endLine: 5,
        });
        expect(local!.general).toBeUndefined();
    });

    it("bucket 2: falls back to leftFileStart when no right context", () => {
        const local = conv(
            thread({
                threadContext: {
                    filePath: "/docs/a.md",
                    leftFileStart: { line: 9 },
                },
            }),
        );

        expect(local!.anchor.line).toBe(9);
        expect(local!.anchor.endLine).toBe(9);
    });

    it.each([
        { name: "without line context", context: {} },
        { name: "placed on line 0", context: { rightFileStart: { line: 0, offset: 0 } } },
    ])("bucket 2: file thread $name gets an empty anchor", ({ context }) => {
        const local = conv(thread({ threadContext: { filePath: "/docs/a.md", ...context } }));

        expect(local!.origin).toBe("ado");
        expect(local!.anchor).toStrictEqual({ exact: "", prefix: "", suffix: "" });
    });

    it("bucket 3: general PR-level comment with no file context", () => {
        const local = conv(thread({ comments: [comment()] }));
        expect(local!.origin).toBe("ado");
        expect(local!.general).toBe(true);
        expect(local!.filePath).toBe("");
        expect(local!.anchor).toEqual({ exact: "", prefix: "", suffix: "" });
    });

    it("maps thread status (Fixed → resolved)", () => {
        const local = conv(thread({ status: 2 /* Fixed */ }));
        expect(local!.status).toBe("resolved");
    });
});

describe("fromAdoStatus", () => {
    it.each([
        ["Fixed", 2, "resolved"],
        ["ByDesign", 5, "resolved"],
        ["WontFix", 3, "wontFix"],
        ["Closed", 4, "closed"],
        ["Pending", 6, "pending"],
        ["Active", 1, "active"],
        ["Unknown", 0, "active"],
        ["missing", undefined, "active"],
    ])("shows an ADO %s (%s) thread as %s", (_name, status, local) => {
        expect(fromAdoStatus(status)).toBe(local);
    });
});

describe("editedAtOf", () => {
    it("returns undefined when there is no update timestamp", () => {
        expect(editedAtOf(new Date("2024-01-01T00:00:00Z"), undefined)).toBeUndefined();
    });

    it("returns the ISO update time for a genuine later edit", () => {
        expect(editedAtOf(new Date("2024-01-01T00:00:00Z"), new Date("2024-01-02T03:04:05Z"))).toBe(
            "2024-01-02T03:04:05.000Z",
        );
    });

    it("treats an update within a second of publishing as unedited", () => {
        expect(
            editedAtOf(new Date("2024-01-01T00:00:00.000Z"), new Date("2024-01-01T00:00:01.000Z")),
        ).toBeUndefined();
    });

    it("treats a missing publishedDate as epoch (any update counts as edited)", () => {
        expect(editedAtOf(undefined, new Date("2024-01-02T03:04:05Z"))).toBe(
            "2024-01-02T03:04:05.000Z",
        );
    });
});

describe("buildThreadContext", () => {
    it("uses anchor line/column coordinates when present", () => {
        expect(
            buildThreadContext("/docs/table.md", {
                exact: "Mechanism",
                prefix: "",
                suffix: "",
                line: 12,
                endLine: 12,
                column: 9,
                endColumn: 17,
            }),
        ).toEqual({
            filePath: "/docs/table.md",
            rightFileStart: { line: 12, offset: 9 },
            rightFileEnd: { line: 12, offset: 17 },
        });
    });

    it("falls back to 1:1 when the anchor has no source location", () => {
        expect(
            buildThreadContext("/docs/a.md", {
                exact: "hello",
                prefix: "",
                suffix: "",
            }),
        ).toEqual({
            filePath: "/docs/a.md",
            rightFileStart: { line: 1, offset: 1 },
            rightFileEnd: { line: 1, offset: 1 },
        });
    });

    it("clamps end coordinates so they never precede start coordinates", () => {
        expect(
            buildThreadContext("/docs/a.md", {
                exact: "hello",
                prefix: "",
                suffix: "",
                line: 5,
                endLine: 3,
                column: 10,
                endColumn: 2,
            }),
        ).toEqual({
            filePath: "/docs/a.md",
            rightFileStart: { line: 5, offset: 10 },
            rightFileEnd: { line: 5, offset: 10 },
        });
    });

    it("keeps the end column of a selection spanning several lines", () => {
        expect(
            buildThreadContext("/docs/a.md", {
                exact: "x",
                prefix: "",
                suffix: "",
                line: 2,
                endLine: 4,
                column: 9,
                endColumn: 6,
            }),
        ).toEqual({
            filePath: "/docs/a.md",
            rightFileStart: { line: 2, offset: 9 },
            rightFileEnd: { line: 4, offset: 6 },
        });
    });

    it("anchors a comment whose source position is zeroed at the start of the file", () => {
        expect(
            buildThreadContext("/docs/a.md", {
                exact: "hello",
                prefix: "",
                suffix: "",
                line: 0,
                endLine: 0,
                column: 0,
                endColumn: 0,
            }),
        ).toEqual({
            filePath: "/docs/a.md",
            rightFileStart: { line: 1, offset: 1 },
            rightFileEnd: { line: 1, offset: 1 },
        });
    });
});

// LineDiffBlockChangeType runtime values: 0=None, 1=Add, 2=Delete, 3=Edit.
describe("lineDiffBlocksToRanges", () => {
    it("maps an Add block to an `added` span (modified line numbers)", () => {
        const ranges = lineDiffBlocksToRanges([
            {
                changeType: 1,
                modifiedLineNumberStart: 10,
                modifiedLinesCount: 3,
                originalLineNumberStart: 0,
                originalLinesCount: 0,
            },
        ]);

        expect(ranges).toEqual([
            {
                startLine: 10,
                endLine: 12,
                kind: "added",
                linesAdded: 3,
                linesDeleted: 0,
            },
        ]);
    });

    it("maps an Edit block to a `modified` span carrying both counts", () => {
        const ranges = lineDiffBlocksToRanges([
            {
                changeType: 3,
                modifiedLineNumberStart: 5,
                modifiedLinesCount: 2,
                originalLineNumberStart: 5,
                originalLinesCount: 4,
            },
        ]);

        expect(ranges).toEqual([
            {
                startLine: 5,
                endLine: 6,
                kind: "modified",
                originalStartLine: 5,
                originalEndLine: 8,
                linesAdded: 2,
                linesDeleted: 4,
            },
        ]);
    });

    it("attaches originalText to a modified span when original lines are given", () => {
        const originalLines = ["l1", "l2", "l3", "old sentence here", "l5"];

        const ranges = lineDiffBlocksToRanges(
            [
                {
                    changeType: 3,
                    modifiedLineNumberStart: 4,
                    modifiedLinesCount: 1,
                    originalLineNumberStart: 4,
                    originalLinesCount: 1,
                },
            ],
            originalLines,
        );

        expect(ranges[0]).toMatchObject({
            kind: "modified",
            originalText: "old sentence here",
        });
    });

    it("omits originalText on a modified span when no original lines are given", () => {
        const ranges = lineDiffBlocksToRanges([
            {
                changeType: 3,
                modifiedLineNumberStart: 4,
                modifiedLinesCount: 1,
                originalLineNumberStart: 4,
                originalLinesCount: 1,
            },
        ]);

        expect(ranges[0]).not.toHaveProperty("originalText");
    });

    it("maps a Delete block to a single-line `deleted-marker` with no content", () => {
        const ranges = lineDiffBlocksToRanges([
            {
                changeType: 2,
                modifiedLineNumberStart: 8,
                modifiedLinesCount: 0,
                originalLineNumberStart: 8,
                originalLinesCount: 3,
            },
        ]);

        expect(ranges).toEqual([
            {
                startLine: 8,
                endLine: 8,
                kind: "deleted-marker",
                linesAdded: 0,
                linesDeleted: 3,
            },
        ]);
        // getFileDiffs gives no removed text, so the marker has no body.
        expect(ranges[0]).not.toHaveProperty("deletedContent");
    });

    it("slices removed text into `deletedContent` when original lines are given", () => {
        // The original file's lines 8–10 (1-based) were removed.
        const originalLines = [
            "line 1",
            "line 2",
            "line 3",
            "line 4",
            "line 5",
            "line 6",
            "line 7",
            "## Legacy Options",
            "",
            "The legacyRenderer flag is retained.",
            "line 11",
        ];

        const ranges = lineDiffBlocksToRanges(
            [
                {
                    changeType: 2,
                    modifiedLineNumberStart: 8,
                    modifiedLinesCount: 0,
                    originalLineNumberStart: 8,
                    originalLinesCount: 3,
                },
            ],
            originalLines,
        );

        expect(ranges[0]).toMatchObject({
            kind: "deleted-marker",
            linesDeleted: 3,
            deletedContent: "## Legacy Options\n\nThe legacyRenderer flag is retained.",
        });
    });

    it("slices removed text for an Edit block that only removed lines", () => {
        const originalLines = ["a", "b", "gone one", "gone two", "c"];

        const ranges = lineDiffBlocksToRanges(
            [
                {
                    changeType: 3,
                    modifiedLineNumberStart: 3,
                    modifiedLinesCount: 0,
                    originalLineNumberStart: 3,
                    originalLinesCount: 2,
                },
            ],
            originalLines,
        );

        expect(ranges[0]).toMatchObject({
            kind: "deleted-marker",
            deletedContent: "gone one\ngone two",
        });
    });

    it("omits `deletedContent` when the sliced original range is empty", () => {
        const ranges = lineDiffBlocksToRanges(
            [
                {
                    changeType: 2,
                    modifiedLineNumberStart: 5,
                    modifiedLinesCount: 0,
                    originalLineNumberStart: 99,
                    originalLinesCount: 2,
                },
            ],
            ["only", "four", "short", "lines"],
        );

        expect(ranges[0]).not.toHaveProperty("deletedContent");
    });

    it("clamps a Delete at line 0 up to line 1", () => {
        const ranges = lineDiffBlocksToRanges([
            {
                changeType: 2,
                modifiedLineNumberStart: 0,
                modifiedLinesCount: 0,
                originalLineNumberStart: 1,
                originalLinesCount: 2,
            },
        ]);

        expect(ranges[0]).toMatchObject({
            startLine: 1,
            endLine: 1,
            kind: "deleted-marker",
        });
    });

    it("treats an Edit that left no modified lines as a deletion marker", () => {
        const ranges = lineDiffBlocksToRanges([
            {
                changeType: 3,
                modifiedLineNumberStart: 4,
                modifiedLinesCount: 0,
                originalLineNumberStart: 4,
                originalLinesCount: 5,
            },
        ]);

        expect(ranges[0]).toMatchObject({
            startLine: 4,
            endLine: 4,
            kind: "deleted-marker",
            linesDeleted: 5,
        });
    });

    it("treats an Edit that removed no original lines as a pure addition", () => {
        // ADO occasionally labels a pure insertion (0 original lines) as an Edit
        // block; it should still surface as green "added", not amber "modified".
        const ranges = lineDiffBlocksToRanges([
            {
                changeType: 3,
                modifiedLineNumberStart: 9,
                modifiedLinesCount: 4,
                originalLineNumberStart: 8,
                originalLinesCount: 0,
            },
        ]);

        expect(ranges).toEqual([
            {
                startLine: 9,
                endLine: 12,
                kind: "added",
                linesAdded: 4,
                linesDeleted: 0,
            },
        ]);
    });

    it.each([
        { name: "only unchanged (None) blocks", blocks: [{ changeType: 0 }] },
        { name: "no blocks", blocks: undefined },
    ])("has no ranges for $name", ({ blocks }) => {
        expect(lineDiffBlocksToRanges(blocks)).toEqual([]);
    });

    it("skips Add blocks that carry no modified lines", () => {
        expect(
            lineDiffBlocksToRanges([
                {
                    changeType: 1,
                    modifiedLineNumberStart: 4,
                    modifiedLinesCount: 0,
                },
                { changeType: 1, modifiedLineNumberStart: 4 },
            ]),
        ).toEqual([]);
    });

    it("treats a block with no changeType as an unchanged (None) block", () => {
        // A diff block that carries line numbers but no change type is not a real
        // edit, so it contributes no comment-able ranges.
        expect(
            lineDiffBlocksToRanges([{ modifiedLineNumberStart: 5, modifiedLinesCount: 2 }]),
        ).toEqual([]);
    });

    it("preserves order across a mix of blocks", () => {
        const ranges = lineDiffBlocksToRanges([
            {
                changeType: 1,
                modifiedLineNumberStart: 1,
                modifiedLinesCount: 1,
            },
            {
                changeType: 2,
                modifiedLineNumberStart: 3,
                originalLinesCount: 2,
            },
            {
                changeType: 3,
                modifiedLineNumberStart: 6,
                modifiedLinesCount: 2,
                originalLinesCount: 1,
            },
        ]);

        expect(ranges.map((r) => r.kind)).toEqual(["added", "deleted-marker", "modified"]);
    });
});

describe("lineDiffBlocksToCounts", () => {
    it("sums added / deleted lines across block types", () => {
        const counts = lineDiffBlocksToCounts([
            { changeType: 1, modifiedLinesCount: 3 },
            { changeType: 2, originalLinesCount: 2 },
            { changeType: 3, modifiedLinesCount: 4, originalLinesCount: 1 },
            { changeType: 0, modifiedLinesCount: 99, originalLinesCount: 99 },
        ]);

        expect(counts).toEqual({ linesAdded: 7, linesDeleted: 3 });
    });

    it("returns zeros for undefined input", () => {
        expect(lineDiffBlocksToCounts(undefined)).toEqual({
            linesAdded: 0,
            linesDeleted: 0,
        });
    });

    it("counts nothing for blocks that arrive without line counts", () => {
        const counts = lineDiffBlocksToCounts([
            { changeType: 1 },
            { changeType: 2 },
            { changeType: 3 },
            {},
        ]);

        expect(counts).toEqual({ linesAdded: 0, linesDeleted: 0 });
    });
});
