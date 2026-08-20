import { describe, expect, it } from "vitest";

import {
  buildReplyComment,
  buildRootComment,
  reactionClientMethod,
  toAdoStatusValue,
  ROOT_PARENT_COMMENT_ID,
  REPLY_PARENT_COMMENT_ID,
  COMMENT_TYPE_TEXT,
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
    expect(ROOT_PARENT_COMMENT_ID).toBe(0);
    expect(COMMENT_TYPE_TEXT).toBe(1);
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
    expect(REPLY_PARENT_COMMENT_ID).toBe(1);
  });

  it("uses a different parent than a root comment", () => {
    expect(buildReplyComment("x").parentCommentId).not.toBe(
      buildRootComment("x").parentCommentId,
    );
  });
});

describe("toAdoStatusValue", () => {
  it("maps each local status to its exact ADO numeric enum value", () => {
    expect(toAdoStatusValue("active")).toBe(1); // Active
    expect(toAdoStatusValue("resolved")).toBe(2); // Fixed
    expect(toAdoStatusValue("wontFix")).toBe(3); // WontFix
    expect(toAdoStatusValue("closed")).toBe(4); // Closed
    expect(toAdoStatusValue("pending")).toBe(6); // Pending
  });

  it("never collapses distinct statuses onto the same value", () => {
    const values = (
      ["active", "resolved", "wontFix", "closed", "pending"] as const
    ).map(toAdoStatusValue);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("reactionClientMethod", () => {
  it("adds via createLike and removes via deleteLike (not inverted)", () => {
    expect(reactionClientMethod(true)).toBe("createLike");
    expect(reactionClientMethod(false)).toBe("deleteLike");
  });
});
