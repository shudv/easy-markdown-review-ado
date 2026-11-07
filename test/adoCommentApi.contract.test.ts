import { describe, expect, it } from "vitest";

import {
    buildReplyComment,
    buildRootComment,
    reactionClientMethod,
    toAdoStatusValue,
} from "../src/shell/adoCommentApi.helpers";

// Contract tests for the exact payloads / client-method selection the
// AdoCommentApi sends to Azure DevOps. These invariants have NO local symptom
// when broken (optimistic UI masks a wrong remote id / inverted status), so
// they must be locked at the payload-builder boundary.

describe("buildRootComment", () => {
    it("parents the first comment onto 0 with commentType Text", () => {
        expect(buildRootComment("hello")).toEqual({
            parentCommentId: 0,
            content: "hello",
            commentType: 1,
        });
    });

    it("passes the body through verbatim", () => {
        const body = "line1\n\n**bold** and `code`";
        expect(buildRootComment(body).content).toBe(body);
    });
});

describe("buildReplyComment", () => {
    it("parents a reply onto the root comment id 1 (not 0)", () => {
        expect(buildReplyComment("reply")).toEqual({
            parentCommentId: 1,
            content: "reply",
            commentType: 1,
        });
    });
});

describe("toAdoStatusValue", () => {
    it.each([
        ["active", 1, "Active"],
        ["resolved", 2, "Fixed"],
        ["wontFix", 3, "WontFix"],
        ["closed", 4, "Closed"],
        ["pending", 6, "Pending"],
    ] as const)("saves a %s thread as ADO status %i (%s)", (status, value, _adoName) => {
        expect(toAdoStatusValue(status)).toBe(value);
    });
});

describe("reactionClientMethod", () => {
    it.each([
        { name: "adds a like via createLike", add: true, method: "createLike" },
        { name: "removes a like via deleteLike", add: false, method: "deleteLike" },
    ])("$name", ({ add, method }) => {
        expect(reactionClientMethod(add)).toBe(method);
    });
});
