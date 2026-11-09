// Tests for the auth-failure capture helpers (pure parts): URL classification,
// id-free API area, the event-input builder, and the throttle.

import { describe, expect, it } from "vitest";

import {
    apiAreaOf,
    authFailureInput,
    createThrottle,
    isAdoApiUrl,
    isLegacyHost,
} from "../src/telemetry/authFailureCapture";

describe("isAdoApiUrl", () => {
    it.each([
        ["https://dev.azure.com/org/proj/_apis/git/x", true],
        ["https://office.visualstudio.com/p/_apis/git/x", true],
        ["https://dev.azure.com/org/_git/repo", false],
        ["https://example.com/foo", false],
    ])("treats %s as an ADO REST call: %s", (url, expected) => {
        expect(isAdoApiUrl(url)).toBe(expected);
    });
});

describe("isLegacyHost", () => {
    it.each([
        ["https://office.visualstudio.com/p/_apis/git/x", true],
        ["https://dev.azure.com/office/p/_apis/git/x", false],
        ["https://almsearch.dev.azure.com/o/_apis/x", false],
    ])("treats %s as a legacy {org}.visualstudio.com host: %s", (url, expected) => {
        expect(isLegacyHost(url)).toBe(expected);
    });
});

describe("apiAreaOf", () => {
    it.each([
        {
            name: "drops a numeric id and lowercases the controller",
            url: "https://office.visualstudio.com/p/_apis/git/pullRequests/5345858",
            expected: "git.pullrequests",
        },
        {
            name: "drops a repository GUID",
            url: "https://dev.azure.com/o/_apis/git/repositories/20053a6a-db9f-40dc-9deb-53536822791d/pullRequests",
            expected: "git.repositories",
        },
        {
            name: "keeps only the area when the next segment is a project name",
            url: "https://dev.azure.com/o/_apis/projects/SecretProject",
            expected: "projects",
        },
        {
            name: "keeps only the area when the next segment is a repository name",
            url: "https://dev.azure.com/o/_apis/git/SecretRepoName",
            expected: "git",
        },
    ])("$name", ({ url, expected }) => {
        expect(apiAreaOf(url)).toBe(expected);
    });

    it.each([["https://dev.azure.com/o/_apis/"], ["https://dev.azure.com/o/_git/repo"]])(
        "reports no area for %s, which names no API",
        (url) => {
            expect(apiAreaOf(url)).toBeUndefined();
        },
    );
});

describe("authFailureInput", () => {
    it("captures status, area, legacy host, and header presence as booleans", () => {
        const headers: Record<string, string> = {
            "x-tfs-fedauthredirect": "1",
            "www-authenticate": "Bearer",
        };

        const get = (n: string) => headers[n.toLowerCase()] ?? null;

        const out = authFailureInput(
            "https://office.visualstudio.com/p/_apis/git/pullRequests/1",
            401,
            get,
        );

        expect(out).toEqual({
            status: 401,
            api: "git.pullrequests",
            legacyHost: true,
            fedAuthRedirect: true,
            serviceError: false,
            wwwAuthenticate: true,
        });
    });
});

describe("createThrottle", () => {
    it("reports the first failure for a key and suppresses repeats within the cooldown", () => {
        const allow = createThrottle(30_000, () => 1000);

        expect(allow("401:git.pullrequests")).toBe(true);
        expect(allow("401:git.pullrequests")).toBe(false);
    });

    it("reports a different failure independently during another's cooldown", () => {
        const allow = createThrottle(30_000, () => 1000);
        allow("401:git.pullrequests");

        expect(allow("403:git.pullrequests")).toBe(true);
    });

    it("reports the same failure again once the cooldown has passed", () => {
        let now = 1000;
        const allow = createThrottle(30_000, () => now);
        allow("401:git.pullrequests");
        now += 30_001;

        expect(allow("401:git.pullrequests")).toBe(true);
    });
});
