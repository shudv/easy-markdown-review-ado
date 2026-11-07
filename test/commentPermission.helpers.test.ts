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
        expect(GIT_REPOSITORIES_NAMESPACE_ID).toBe("2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87");
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
    it.each([
        ["dev.azure.com over https", "https://dev.azure.com/myorg"],
        ["a legacy <org>.visualstudio.com over https", "https://myorg.visualstudio.com"],
    ])("accepts %s", (_label, url) => {
        expect(isAzureDevOpsOrgUrl(url)).toBe(true);
    });

    // The org URL receives the user's access token, so anything that is not
    // verifiably Azure DevOps over https must be refused.
    it.each([
        // eslint-disable-next-line sonarjs/no-clear-text-protocols -- negative case: asserts an http:// org URL is rejected
        ["plain http (token in clear text)", "http://dev.azure.com/myorg"],
        ["a foreign host", "https://evil.example.com/myorg"],
        ["a host that starts with dev.azure.com", "https://dev.azure.com.evil.com"],
        ["another host that starts with dev.azure.com", "https://dev.azure.com.evil.io"],
        ["a host embedding .visualstudio.com", "https://evil.visualstudio.com.attacker.com"],
        ["the bare visualstudio.com apex with no org", "https://visualstudio.com"],
        ["a look-alike ending in visualstudio.com", "https://notvisualstudio.com"],
        ["an unparseable URL", "not a url"],
        ["an empty URL", ""],
    ])("rejects %s", (_label, url) => {
        expect(isAzureDevOpsOrgUrl(url)).toBe(false);
    });
});

describe("commentPermissionFromResponse", () => {
    it.each([
        ["denies when the bit is refused", [false], false],
        ["allows when the bit is granted", [true], true],
        ["denies when any requested bit is refused", [true, false], false],
    ])("%s", (_label, value, canComment) => {
        expect(commentPermissionFromResponse({ value })).toEqual({ canComment, resolved: true });
    });

    it.each([
        ["missing body", undefined],
        ["null body", null],
        ["no value", {}],
        ["empty value", { value: [] }],
        ["non-array value", { value: "nope" }],
    ])("stays optimistic and unresolved for %s", (_label, body) => {
        expect(commentPermissionFromResponse(body as { value?: unknown } | null)).toEqual({
            canComment: true,
            resolved: false,
        });
    });
});

describe("COMMENT_PERMISSION_DENIED_MESSAGE", () => {
    it("tells the user which access level commenting needs", () => {
        expect(COMMENT_PERMISSION_DENIED_MESSAGE).toContain("requires Contribute access");
    });
});
