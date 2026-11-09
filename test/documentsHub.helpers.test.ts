import { describe, expect, it } from "vitest";

import {
    assembleHubDeepLinkUrl,
    buildHubDocUrl,
    formatError,
    initialsOf,
    orgUrlFromReferrer,
    routeUpdatesForPath,
} from "../src/hub/documentsHub.helpers";

/** Build the document location the hub URL helpers take. */
function hubDoc(orgUrl: string, projectName: string, repoId: string, path: string) {
    return { orgUrl, projectName, repoId, path };
}

describe("initialsOf", () => {
    it("uses the first two letters of a single name", () => {
        expect(initialsOf("Alice")).toBe("AL");
    });
    it.each([
        ["Ada  Lovelace", "AL"],
        ["  Grace Brewster Hopper ", "GH"],
    ])("uses first + last initials for the multi-word name %j", (name, initials) => {
        expect(initialsOf(name)).toBe(initials);
    });
    it("returns an empty string for a blank name", () => {
        expect(initialsOf("   ")).toBe("");
    });
});

describe("formatError", () => {
    it("prefers an Error's stack", () => {
        const e = new Error("boom");
        expect(formatError(e)).toBe(e.stack);
    });
    it.each([
        ["empty", ""],
        ["missing", undefined],
    ])("falls back to the message when the stack is %s", (_state, stack) => {
        const e = new Error("boom");
        e.stack = stack;
        expect(formatError(e)).toBe("boom");
    });
    it("pretty-prints non-null objects", () => {
        expect(formatError({ a: 1 })).toBe(JSON.stringify({ a: 1 }, null, 2));
    });
    it.each([
        ["oops", "oops"],
        [null, "null"],
        [42, "42"],
    ])("stringifies the thrown value %j", (thrown, text) => {
        expect(formatError(thrown)).toBe(text);
    });
});

describe("assembleHubDeepLinkUrl", () => {
    const EXT = { publisherId: "pub", extensionId: "ext" };
    const T = { kind: "comment" as const, threadId: "t" };

    it.each([
        { name: "an org", org: "", project: "Proj" },
        { name: "a project", org: "https://dev.azure.com/org", project: "" },
    ])("has no link without $name", ({ org, project }) => {
        expect(assembleHubDeepLinkUrl(hubDoc(org, project, "r", "/x.md"), EXT, T)).toBeUndefined();
    });

    it("returns undefined when the base URL is malformed", () => {
        expect(
            assembleHubDeepLinkUrl(hubDoc("not a url", "Proj", "r", "/x.md"), EXT, T),
        ).toBeUndefined();
    });

    it("assembles a hub URL with repo, path and comment params", () => {
        const url = assembleHubDeepLinkUrl(
            hubDoc("https://dev.azure.com/org/", "My Proj", "repo1", "/docs/a.md"),
            EXT,
            { kind: "comment", threadId: "42" },
        );

        expect(url).toBeDefined();
        const parsed = new URL(url!);
        expect(parsed.pathname).toBe("/org/My%20Proj/_apps/hub/pub.ext.documents-hub");
        expect(parsed.searchParams.get("repo")).toBe("repo1");
        expect(parsed.searchParams.get("path")).toBe("docs/a.md");
        expect(parsed.searchParams.get("comment")).toBe("42");
    });

    it("assembles a hub URL with a heading anchor", () => {
        const parsed = new URL(
            assembleHubDeepLinkUrl(
                hubDoc("https://dev.azure.com/org", "Proj", "repo1", "/docs/a.md"),
                EXT,
                { kind: "heading", anchor: "goals" },
            )!,
        );

        expect(parsed.searchParams.get("path")).toBe("docs/a.md");
        expect(parsed.searchParams.get("anchor")).toBe("goals");
        expect(parsed.searchParams.has("comment")).toBe(false);
    });

    it("returns undefined for a blank thread", () => {
        expect(
            assembleHubDeepLinkUrl(hubDoc("https://dev.azure.com/org", "Proj", "", "/"), EXT, {
                kind: "comment",
                threadId: "",
            }),
        ).toBeUndefined();
    });

    it("omits an empty repo and a root path on a valid target", () => {
        const url = new URL(
            assembleHubDeepLinkUrl(hubDoc("https://dev.azure.com/org", "Proj", "", "/"), EXT, {
                kind: "heading",
                anchor: "goals",
            })!,
        );

        expect(url.searchParams.has("repo")).toBe(false);
        expect(url.searchParams.has("path")).toBe(false);
        expect(url.searchParams.get("anchor")).toBe("goals");
    });
});

describe("routeUpdatesForPath", () => {
    it("pins the repo and the slash-free path", () => {
        expect(routeUpdatesForPath({}, "r1", "/docs/a.md")).toEqual({
            repo: "r1",
            path: "docs/a.md",
            anchor: "",
            comment: "",
            text: "",
        });
    });

    it("keeps an already slash-free path as-is", () => {
        expect(routeUpdatesForPath({}, "r1", "docs/a.md").path).toBe("docs/a.md");
    });

    // The hub publishes the deep-linked document on load; that must not wipe
    // the `?anchor=` / `?comment=` the recipient arrived with.
    it.each([
        {
            name: "the same document",
            current: { repo: "r1", path: "docs/a.md", anchor: "goals", comment: "42" },
            path: "/docs/a.md",
        },
        {
            name: "the same document spelled with extra leading slashes",
            current: { repo: "r1", path: "//docs/a.md", anchor: "goals" },
            path: "//docs/a.md",
        },
    ])("keeps a deep link when re-publishing $name", ({ current, path }) => {
        expect(routeUpdatesForPath(current, "r1", path)).toEqual({ repo: "r1", path: "docs/a.md" });
    });

    it("drops the heading, text and comment when moving to a different document", () => {
        // A linked comment that never activated (deleted, or still loading) must
        // not ride along with the new path.
        expect(
            routeUpdatesForPath(
                { path: "docs/a.md", anchor: "goals", comment: "42" },
                "r1",
                "/docs/b.md",
            ),
        ).toEqual({
            repo: "r1",
            path: "docs/b.md",
            anchor: "",
            comment: "",
            text: "",
        });
    });

    it("drops the heading, text and comment when the same path opens in a different repo", () => {
        expect(
            routeUpdatesForPath(
                {
                    repo: "r1",
                    path: "README.md",
                    anchor: "goals",
                    comment: "42",
                },
                "r2",
                "/README.md",
            ),
        ).toEqual({
            repo: "r2",
            path: "README.md",
            anchor: "",
            comment: "",
            text: "",
        });
    });

    it.each([
        ["without", undefined],
        ["with a blank", ""],
    ])("treats a link %s ?repo= as naming the opened repo", (_form, repo) => {
        expect(
            routeUpdatesForPath({ repo, path: "README.md", anchor: "goals" }, "r2", "/README.md"),
        ).toEqual({ repo: "r2", path: "README.md" });
    });
});

describe("orgUrlFromReferrer", () => {
    it("returns an empty string for an empty referrer", () => {
        expect(orgUrlFromReferrer("")).toBe("");
    });
    it("returns an empty string for an unparseable referrer", () => {
        expect(orgUrlFromReferrer("::::")).toBe("");
    });
    it("uses the first path segment (the org) when present", () => {
        expect(orgUrlFromReferrer("https://dev.azure.com/myorg/proj/_git")).toBe(
            "https://dev.azure.com/myorg",
        );
    });
    it("falls back to the origin when there is no path", () => {
        expect(orgUrlFromReferrer("https://dev.azure.com/")).toBe("https://dev.azure.com");
    });
});

describe("buildHubDocUrl", () => {
    const EXT = { publisherId: "pub", extensionId: "ext" };

    it("builds a hub URL with repo + path params (no comment)", () => {
        expect(
            buildHubDocUrl(hubDoc("https://dev.azure.com/org", "Proj", "repo1", "/docs/x.md"), EXT),
        ).toBe(
            "https://dev.azure.com/org/Proj/_apps/hub/pub.ext.documents-hub?repo=repo1&path=docs%2Fx.md",
        );
    });

    it.each([
        { name: "an org", org: "", project: "Proj" },
        { name: "a project", org: "https://dev.azure.com/org", project: "" },
    ])("has no URL without $name", ({ org, project }) => {
        expect(buildHubDocUrl(hubDoc(org, project, "r", "/x.md"), EXT)).toBeUndefined();
    });

    it("returns undefined when the base URL is malformed", () => {
        expect(buildHubDocUrl(hubDoc("not a url", "Proj", "r", "/x.md"), EXT)).toBeUndefined();
    });

    it("keeps every folder of a nested document path", () => {
        expect(
            buildHubDocUrl(
                hubDoc("https://dev.azure.com/org", "Proj", "r", "docs/guide/x.md"),
                EXT,
            ),
        ).toBe(
            "https://dev.azure.com/org/Proj/_apps/hub/pub.ext.documents-hub?repo=r&path=docs%2Fguide%2Fx.md",
        );
    });

    it("omits the repo param when no repo id is given", () => {
        expect(buildHubDocUrl(hubDoc("https://dev.azure.com/org", "Proj", "", "/x.md"), EXT)).toBe(
            "https://dev.azure.com/org/Proj/_apps/hub/pub.ext.documents-hub?path=x.md",
        );
    });

    it("collapses redundant slashes in the org URL and path", () => {
        expect(
            buildHubDocUrl(hubDoc("https://dev.azure.com/org//", "Proj", "r", "//docs/x.md"), EXT),
        ).toBe(
            "https://dev.azure.com/org/Proj/_apps/hub/pub.ext.documents-hub?repo=r&path=docs%2Fx.md",
        );
    });
});
