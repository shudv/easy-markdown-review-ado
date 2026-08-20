import { describe, expect, it } from "vitest";

import {
  COMMENT_PERMISSION_DENIED_MESSAGE,
  GIT_CONTRIBUTE_BIT,
  GIT_REPOSITORIES_NAMESPACE_ID,
  commentPermissionFromResponse,
  hasPermissionsPath,
  isAzureDevOpsOrgUrl,
  repoSecurityToken,
} from "../src/shell/commentPermission.helpers";

describe("repoSecurityToken", () => {
  it("addresses a single repo under its project", () => {
    expect(repoSecurityToken("proj", "repo")).toBe("repoV2/proj/repo");
  });
});

describe("hasPermissionsPath", () => {
  it("builds the has-permissions REST path with an encoded token", () => {
    expect(
      hasPermissionsPath(
        GIT_REPOSITORIES_NAMESPACE_ID,
        GIT_CONTRIBUTE_BIT,
        repoSecurityToken("p", "r"),
      ),
    ).toBe(
      `_apis/permissions/${GIT_REPOSITORIES_NAMESPACE_ID}/4` +
        "?tokens=repoV2%2Fp%2Fr&api-version=7.1",
    );
  });
});

describe("isAzureDevOpsOrgUrl", () => {
  it("accepts dev.azure.com over https", () => {
    expect(isAzureDevOpsOrgUrl("https://dev.azure.com/myorg")).toBe(true);
  });

  it("accepts legacy <org>.visualstudio.com over https", () => {
    expect(isAzureDevOpsOrgUrl("https://myorg.visualstudio.com")).toBe(true);
  });

  it("rejects non-https schemes (no token over http)", () => {
    expect(isAzureDevOpsOrgUrl("http://dev.azure.com/myorg")).toBe(false);
  });

  it("rejects non-ADO hosts so the access token never leaks", () => {
    expect(isAzureDevOpsOrgUrl("https://evil.example.com/myorg")).toBe(false);
    expect(isAzureDevOpsOrgUrl("https://dev.azure.com.evil.com")).toBe(false);
  });

  it("rejects a visualstudio.com look-alike that only *contains* the suffix", () => {
    // Guards the suffix (`endsWith`) rule against a substring (`includes`)
    // regression: a host that embeds `.visualstudio.com` mid-string but is
    // rooted at an attacker domain must not receive the access token.
    expect(
      isAzureDevOpsOrgUrl("https://evil.visualstudio.com.attacker.com"),
    ).toBe(false);
    // Bare apex / missing the leading dotted org label is not a valid org URL.
    expect(isAzureDevOpsOrgUrl("https://visualstudio.com")).toBe(false);
    expect(isAzureDevOpsOrgUrl("https://notvisualstudio.com")).toBe(false);
    // A host that merely starts with the trusted apex is still foreign.
    expect(isAzureDevOpsOrgUrl("https://dev.azure.com.evil.io")).toBe(false);
  });

  it("rejects an unparseable URL", () => {
    expect(isAzureDevOpsOrgUrl("not a url")).toBe(false);
    expect(isAzureDevOpsOrgUrl("")).toBe(false);
  });
});

describe("commentPermissionFromResponse", () => {
  it("denies on an explicit all-false result", () => {
    expect(commentPermissionFromResponse({ value: [false] })).toEqual({
      canComment: false,
      resolved: true,
    });
  });

  it("allows on an explicit all-true result", () => {
    expect(commentPermissionFromResponse({ value: [true] })).toEqual({
      canComment: true,
      resolved: true,
    });
  });

  it("requires every bit to be granted", () => {
    expect(commentPermissionFromResponse({ value: [true, false] })).toEqual({
      canComment: false,
      resolved: true,
    });
  });

  it.each([
    ["missing body", undefined],
    ["null body", null],
    ["no value", {}],
    ["empty value", { value: [] }],
    ["non-array value", { value: "nope" }],
  ])("stays optimistic and unresolved for %s", (_label, body) => {
    expect(
      commentPermissionFromResponse(body as { value?: unknown } | null),
    ).toEqual({ canComment: true, resolved: false });
  });
});

describe("COMMENT_PERMISSION_DENIED_MESSAGE", () => {
  it("mentions the Contribute requirement", () => {
    expect(COMMENT_PERMISSION_DENIED_MESSAGE).toMatch(/Contribute/);
  });
});
