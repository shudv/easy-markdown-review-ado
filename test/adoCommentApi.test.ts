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
  prStatusLabel,
  readMentionsProp,
  readProp,
} from "../src/shell/adoCommentApi.helpers";
import { identityAvatarUrl } from "../src/shell/adoGitData.helpers";
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
  const SELF =
    "https://dev.azure.com/contoso/_apis/GraphProfile/MemberAvatars/aad.self";

  it("rebuilds the CORS-safe identityImage URL off the org base when the identity has a photo", () => {
    // The identity's OWN image is a host-relative MemberAvatars URL; only its
    // presence matters — the URL is rebuilt from the id + the current user's
    // (absolute) org base, so it can't resolve against the iframe origin.
    expect(
      pickerAvatarUrl(
        ID,
        "/contoso/_apis/GraphProfile/MemberAvatars/aad.other",
        SELF,
      ),
    ).toBe(`https://dev.azure.com/contoso/_api/_common/identityImage?id=${ID}`);
  });

  it("returns undefined when the identity has no photo (so initials show)", () => {
    expect(pickerAvatarUrl(ID, undefined, SELF)).toBeUndefined();
    expect(pickerAvatarUrl(ID, "", SELF)).toBeUndefined();
  });

  it("returns undefined when there is no org base to borrow", () => {
    expect(
      pickerAvatarUrl(
        ID,
        "/x/_apis/GraphProfile/MemberAvatars/aad.other",
        undefined,
      ),
    ).toBeUndefined();
  });
});

describe("readProp", () => {
  it("returns undefined for a non-object container", () => {
    expect(readProp(null, "k")).toBeUndefined();
    expect(readProp("nope", "k")).toBeUndefined();
  });

  it("returns undefined when the key is absent", () => {
    expect(readProp({ other: 1 }, "k")).toBeUndefined();
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

  it("returns a stable hash for the empty string", () => {
    expect(hashString("")).toBe(hashString(""));
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
  it("uses `id =` when the query is purely numeric", () => {
    expect(buildWorkItemWiql("42")).toBe(
      "SELECT [System.Id] FROM WorkItems WHERE [System.Id] = 42",
    );
  });

  it("uses a `Title CONTAINS` clause for text queries", () => {
    const q = buildWorkItemWiql("login bug");
    expect(q).toContain("[System.Title] CONTAINS 'login bug'");
    expect(q).toContain("ORDER BY [System.ChangedDate] DESC");
  });

  it("escapes single quotes in the user-supplied query", () => {
    const q = buildWorkItemWiql("can't log in");
    expect(q).toContain("[System.Title] CONTAINS 'can''t log in'");
  });
});

describe("prStatusLabel", () => {
  it("maps Completed → completed", () => {
    expect(prStatusLabel(PR_STATUS.Completed as never)).toBe("completed");
  });

  it("maps Abandoned → abandoned", () => {
    expect(prStatusLabel(PR_STATUS.Abandoned as never)).toBe("abandoned");
  });

  it("treats undefined / Active / NotSet as `active`", () => {
    expect(prStatusLabel(undefined)).toBe("active");
    expect(prStatusLabel(PR_STATUS.Active as never)).toBe("active");
    expect(prStatusLabel(PR_STATUS.NotSet as never)).toBe("active");
  });
});

describe("initialsOf", () => {
  it("handles a single word by taking the first two letters", () => {
    expect(initialsOf("Alice")).toBe("AL");
  });

  it("handles multi-word names by taking first letter of first + last", () => {
    expect(initialsOf("Alice Anderson")).toBe("AA");
    expect(initialsOf("  Sam   B  Carter  ")).toBe("SC");
  });

  it("returns `?` for empty / whitespace input", () => {
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("   ")).toBe("?");
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
    expect(normalizeIdentityGuid("6b71186cc2e66813b4e0ffcd511163f4")).toBe(
      GUID,
    );
  });

  it("extracts the GUID from the picker's `vss.ds…` entityId form", () => {
    expect(
      normalizeIdentityGuid(
        "vss.ds.v1.ims.user.6b71186cc2e66813b4e0ffcd511163f4",
      ),
    ).toBe(GUID);
  });

  it("returns undefined when there is no GUID and for empty input", () => {
    expect(normalizeIdentityGuid("no-guid-here")).toBeUndefined();
    expect(normalizeIdentityGuid(undefined)).toBeUndefined();
    expect(normalizeIdentityGuid("")).toBeUndefined();
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

  it("returns null without an org or without valid ids", () => {
    expect(buildIdentitiesUrl(undefined, [A])).toBeNull();
    expect(buildIdentitiesUrl("org", [])).toBeNull();
    expect(buildIdentitiesUrl("org", ["", "   "])).toBeNull();
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

  it("omits ids the service didn't return (no wrong-person fallback)", () => {
    const body = { value: [{ id: B, providerDisplayName: "Alan Turing" }] };
    expect(parseIdentitiesResponse(body, [A])).toEqual({});
  });

  it("ignores entries missing an id or a name", () => {
    const body = {
      value: [
        { providerDisplayName: "No Id" },
        { id: A, providerDisplayName: "" },
      ],
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

  it("returns an empty record for a malformed body", () => {
    expect(parseIdentitiesResponse(null, [A])).toEqual({});
    expect(parseIdentitiesResponse({}, [A])).toEqual({});
    expect(parseIdentitiesResponse({ value: "nope" }, [A])).toEqual({});
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
          { displayName: "B" },
          { id: "c", displayName: "C" },
        ]),
      ),
    );
    expect(out).toEqual([{ id: "c", displayName: "C", avatarUrl: undefined }]);
  });

  it("returns [] for missing, blank, malformed, or non-array values", () => {
    expect(readMentionsProp(undefined)).toEqual([]);
    expect(readMentionsProp(wrap(""))).toEqual([]);
    expect(readMentionsProp(wrap("{not json"))).toEqual([]);
    expect(readMentionsProp(wrap(JSON.stringify({ not: "array" })))).toEqual(
      [],
    );
  });
});

describe("collectThreadIdentities", () => {
  const GUID = "6b71186c-c2e6-6813-b4e0-ffcd511163f4";
  const call = (t: Record<string, unknown>) =>
    collectThreadIdentities(t as any);

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
          // Non-string displayName (e.g. a malformed ref) is coerced to "" and
          // skipped — covers the `typeof displayName === "string"` false branch.
          "4": { id: GUID, displayName: 42 },
        },
      }),
    );
    expect(out).toEqual([]);
  });

  it("keeps a non-GUID id verbatim (normalize returns undefined)", () => {
    // ADO ids are normally GUIDs; a non-GUID id exercises the
    // `normalizeIdentityGuid(rawId) ?? rawId` fallback so the ref is preserved
    // rather than dropped.
    const out = call(
      thread({
        identities: { "1": { id: "svc-account", displayName: "Service" } },
      }),
    );
    expect(out).toEqual([
      { id: "svc-account", displayName: "Service", avatarUrl: undefined },
    ]);
  });

  it("returns an empty array when there is no identities map", () => {
    expect(call(thread())).toEqual([]);
    expect(call(thread({ identities: null }))).toEqual([]);
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
        identities: { "1": { id: GUID, displayName: "Shubham Dwivedi" } },
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
              { id: GUID, displayName: "Cross-Tenant Guest", avatarUrl: "g" },
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
    const local = conv(
      thread({ comments: [comment({ publishedDate: undefined })] }),
    );
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
      imageUrl:
        "https://dev.azure.com/contoso/_apis/GraphProfile/MemberAvatars/aad.abc",
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
    expect(local!.comments[0]!.author.avatarUrl).toBe(
      identityAvatarUrl(identity),
    );
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

  it("returns null when the thread has no comments array at all", () => {
    // `t.comments ?? []` ⇒ no comments ⇒ nothing showable.
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
        // No threadContext ⇒ `t.threadContext?.filePath ?? ""` falls back.
      }),
    );
    expect(local!.origin).toBe("extension");
    expect(local!.filePath).toBe("");
    expect(local!.anchor).toEqual(anchor);
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

  it("bucket 1: malformed anchor JSON falls through to native handling", () => {
    const local = conv(
      thread({
        properties: {
          emrSchema: { $value: "1" },
          emrAnchor: { $value: "{not valid json" },
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

  it("bucket 2: file thread without line context gets an empty anchor", () => {
    const local = conv(thread({ threadContext: { filePath: "/docs/a.md" } }));
    expect(local!.origin).toBe("ado");
    expect(local!.anchor).toEqual({ exact: "", prefix: "", suffix: "" });
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
  it("maps the documented status values", () => {
    expect(fromAdoStatus(2)).toBe("resolved"); // Fixed
    expect(fromAdoStatus(5)).toBe("resolved"); // ByDesign
    expect(fromAdoStatus(3)).toBe("wontFix"); // WontFix
    expect(fromAdoStatus(4)).toBe("closed"); // Closed
    expect(fromAdoStatus(6)).toBe("pending"); // Pending
    expect(fromAdoStatus(1)).toBe("active"); // Active
    expect(fromAdoStatus(0)).toBe("active"); // Unknown
    expect(fromAdoStatus(undefined)).toBe("active");
  });
});

describe("editedAtOf", () => {
  it("returns undefined when there is no update timestamp", () => {
    expect(
      editedAtOf(new Date("2024-01-01T00:00:00Z"), undefined),
    ).toBeUndefined();
  });

  it("returns undefined when updated at (or near) publish time", () => {
    const p = new Date("2024-01-01T00:00:00Z");
    expect(editedAtOf(p, p)).toBeUndefined();
    expect(editedAtOf(p, new Date("2024-01-01T00:00:00.999Z"))).toBeUndefined();
  });

  it("returns the ISO update time for a genuine later edit", () => {
    expect(
      editedAtOf(
        new Date("2024-01-01T00:00:00Z"),
        new Date("2024-01-02T03:04:05Z"),
      ),
    ).toBe("2024-01-02T03:04:05.000Z");
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

  it("keeps a genuine multi-line end offset as-is", () => {
    // endLine > startLine, so endOffset is used verbatim (not clamped to start).
    expect(
      buildThreadContext("/docs/a.md", {
        exact: "x",
        prefix: "",
        suffix: "",
        line: 2,
        endLine: 4,
        column: 3,
        endColumn: 6,
      }),
    ).toEqual({
      filePath: "/docs/a.md",
      rightFileStart: { line: 2, offset: 3 },
      rightFileEnd: { line: 4, offset: 6 },
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
      deletedContent:
        "## Legacy Options\n\nThe legacyRenderer flag is retained.",
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

  it("skips None blocks and tolerates undefined input", () => {
    expect(lineDiffBlocksToRanges([{ changeType: 0 }])).toEqual([]);
    expect(lineDiffBlocksToRanges(undefined)).toEqual([]);
  });

  it("treats a block with no changeType as an unchanged (None) block", () => {
    // A diff block that carries line numbers but no change type is not a real
    // edit, so it contributes no comment-able ranges.
    expect(
      lineDiffBlocksToRanges([
        { modifiedLineNumberStart: 5, modifiedLinesCount: 2 },
      ]),
    ).toEqual([]);
  });

  it("preserves order across a mix of blocks", () => {
    const ranges = lineDiffBlocksToRanges([
      { changeType: 1, modifiedLineNumberStart: 1, modifiedLinesCount: 1 },
      { changeType: 2, modifiedLineNumberStart: 3, originalLinesCount: 2 },
      {
        changeType: 3,
        modifiedLineNumberStart: 6,
        modifiedLinesCount: 2,
        originalLinesCount: 1,
      },
    ]);
    expect(ranges.map((r) => r.kind)).toEqual([
      "added",
      "deleted-marker",
      "modified",
    ]);
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

  it("treats absent count/changeType fields as zero for every block type", () => {
    // Each block omits its count field (and the last omits changeType), so the
    // `?? 0` fallbacks fire for the Add, Delete, Edit and default switch arms.
    const counts = lineDiffBlocksToCounts([
      { changeType: 1 }, // Add, no modifiedLinesCount
      { changeType: 2 }, // Delete, no originalLinesCount
      { changeType: 3 }, // Edit, neither count present
      {}, // no changeType ⇒ default arm
    ]);
    expect(counts).toEqual({ linesAdded: 0, linesDeleted: 0 });
  });
});
