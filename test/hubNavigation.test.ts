// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
    getService: vi.fn(),
    getExtensionContext: vi.fn(),
    getHost: vi.fn(),
    getUser: vi.fn(),
}));

vi.mock("azure-devops-extension-sdk", () => sdk);
vi.mock("azure-devops-extension-api", () => ({
    CommonServiceIds: { HostNavigationService: "nav-service" },
}));

import {
    buildHubDeepLinkUrl,
    hubBackLinkFor,
    openInNewTab,
    readCurrentUser,
    readRouteParams,
    resolveOrgUrl,
    setRouteQuery,
} from "../src/hub/hubNavigation";
import { assembleHubDeepLinkUrl, buildHubDocUrl } from "../src/hub/documentsHub.helpers";
import { backLinkUrl } from "../src/shell/backLink";

function navService(params: Record<string, string> | undefined) {
    return {
        getQueryParams: vi.fn(async () => params),
        setQueryParams: vi.fn(),
        openNewWindow: vi.fn(),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("readRouteParams", () => {
    it("returns the host's query params", async () => {
        sdk.getService.mockResolvedValue(navService({ path: "docs/a.md" }));
        await expect(readRouteParams()).resolves.toEqual({ path: "docs/a.md" });
        expect(sdk.getService).toHaveBeenCalledWith("nav-service");
    });

    it("reads no params when the host has none", async () => {
        sdk.getService.mockResolvedValue(navService(undefined));
        await expect(readRouteParams()).resolves.toEqual({});
    });

    it("reads no params when the navigation service is unavailable", async () => {
        sdk.getService.mockRejectedValue(new Error("no host"));
        await expect(readRouteParams()).resolves.toEqual({});
    });
});

describe("without a navigation service", () => {
    it.each([
        { name: "opening a link in a new tab", run: () => openInNewTab("https://x.test") },
        { name: "updating the route", run: () => setRouteQuery({ path: "" }) },
    ])("$name quietly does nothing", async ({ run }) => {
        sdk.getService.mockRejectedValue(new Error("no host"));
        await expect(run()).resolves.toBeUndefined();
    });
});

describe("openInNewTab", () => {
    it("opens the url in a new window", async () => {
        const nav = navService({});
        sdk.getService.mockResolvedValue(nav);
        await openInNewTab("https://example.test/file");
        expect(nav.openNewWindow).toHaveBeenCalledWith("https://example.test/file", "");
    });
});

describe("setRouteQuery", () => {
    it("sends a literal delta as-is", async () => {
        const nav = navService({ repo: "r1" });
        sdk.getService.mockResolvedValue(nav);
        await setRouteQuery({ path: "docs/a.md" });
        expect(nav.getQueryParams).not.toHaveBeenCalled();
        expect(nav.setQueryParams).toHaveBeenCalledWith({ path: "docs/a.md" });
    });

    it("derives the delta from the current params", async () => {
        const nav = navService({ repo: "r1" });
        sdk.getService.mockResolvedValue(nav);
        await setRouteQuery((current) => ({ path: `${current.repo}/x.md` }));
        expect(nav.setQueryParams).toHaveBeenCalledWith({ path: "r1/x.md" });
    });

    it("derives from {} when the host has no params", async () => {
        const nav = navService(undefined);
        sdk.getService.mockResolvedValue(nav);
        const updater = vi.fn(() => ({ path: "" }));
        await setRouteQuery(updater);
        expect(updater).toHaveBeenCalledWith({});
    });
});

describe("buildHubDeepLinkUrl", () => {
    const doc = {
        orgUrl: "https://dev.azure.com/org",
        projectName: "Proj",
        repoId: "r1",
        path: "/docs/a.md",
    };

    const target = { kind: "comment", threadId: "t1" } as const;

    it("assembles the URL from the extension identity", () => {
        const ext = { publisherId: "pub", extensionId: "ext" };
        sdk.getExtensionContext.mockReturnValue(ext);
        expect(buildHubDeepLinkUrl(doc, target)).toBe(assembleHubDeepLinkUrl(doc, ext, target));
    });

    it("returns undefined when the extension context is unavailable", () => {
        sdk.getExtensionContext.mockImplementation(() => {
            throw new Error("not initialized");
        });
        expect(buildHubDeepLinkUrl(doc, target)).toBeUndefined();
    });
});

describe("hubBackLinkFor", () => {
    const thread = { filePath: "/docs/a.md", linkKey: "k-0123456789ab" };

    it("links a thread to its hub document in this org and project, selected", () => {
        const ext = { publisherId: "pub", extensionId: "ext" };
        sdk.getExtensionContext.mockReturnValue(ext);
        sdk.getHost.mockReturnValue({ name: "contoso" });

        const doc = buildHubDocUrl(
            {
                orgUrl: "https://dev.azure.com/contoso",
                projectName: "Proj",
                repoId: "r1",
                path: "/docs/a.md",
            },
            ext,
        );

        expect(hubBackLinkFor("Proj", "r1")(thread)).toBe(backLinkUrl(doc, thread.linkKey));
        expect(new URL(hubBackLinkFor("Proj", "r1")(thread)!).searchParams.get("comment")).toBe(
            "k-0123456789ab",
        );
    });

    it("has no link when the extension context is unavailable", () => {
        sdk.getExtensionContext.mockImplementation(() => {
            throw new Error("not initialized");
        });
        sdk.getHost.mockReturnValue({ name: "contoso" });

        expect(hubBackLinkFor("Proj", "r1")(thread)).toBeUndefined();
    });
});

describe("resolveOrgUrl", () => {
    it("uses the host name when available", () => {
        sdk.getHost.mockReturnValue({ name: "contoso" });
        expect(resolveOrgUrl()).toBe("https://dev.azure.com/contoso");
    });

    describe("falls back to the org in the host page's URL", () => {
        beforeEach(() => {
            vi.spyOn(Document.prototype, "referrer", "get").mockReturnValue(
                "https://dev.azure.com/fabrikam/Proj/_apps/hub/x",
            );
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it.each([
            {
                name: "before the SDK is initialised",
                host: () => {
                    throw new Error("not initialized");
                },
            },
            { name: "when the host context is missing", host: () => undefined },
            { name: "when the host has no name", host: () => ({ name: "" }) },
        ])("$name", ({ host }) => {
            sdk.getHost.mockImplementation(host);
            expect(resolveOrgUrl()).toBe("https://dev.azure.com/fabrikam");
        });
    });
});

describe("readCurrentUser", () => {
    it("projects the SDK user onto a comment author", () => {
        sdk.getUser.mockReturnValue({
            id: "u1",
            displayName: "Ada Lovelace",
            imageUrl: "",
        });
        expect(readCurrentUser()).toMatchObject({
            id: "u1",
            displayName: "Ada Lovelace",
            initials: "AL",
        });
    });
});
