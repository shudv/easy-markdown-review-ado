// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

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
  openInNewTab,
  readCurrentUser,
  readRouteParams,
  resolveOrgUrl,
  setRouteQuery,
} from "../src/hub/hubNavigation";
import { assembleHubDeepLinkUrl } from "../src/hub/documentsHub.helpers";

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

  it("falls back to {} when the host returns nothing or fails", async () => {
    sdk.getService.mockResolvedValueOnce(navService(undefined));
    await expect(readRouteParams()).resolves.toEqual({});
    sdk.getService.mockRejectedValueOnce(new Error("no host"));
    await expect(readRouteParams()).resolves.toEqual({});
  });
});

describe("openInNewTab", () => {
  it("opens the url in a new window", async () => {
    const nav = navService({});
    sdk.getService.mockResolvedValue(nav);
    await openInNewTab("https://example.test/file");
    expect(nav.openNewWindow).toHaveBeenCalledWith(
      "https://example.test/file",
      "",
    );
  });

  it("swallows a missing navigation service", async () => {
    sdk.getService.mockRejectedValue(new Error("no host"));
    await expect(openInNewTab("https://x.test")).resolves.toBeUndefined();
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

  it("swallows a missing navigation service", async () => {
    sdk.getService.mockRejectedValue(new Error("no host"));
    await expect(setRouteQuery({ path: "" })).resolves.toBeUndefined();
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
    expect(buildHubDeepLinkUrl(doc, target)).toBe(
      assembleHubDeepLinkUrl(doc, ext, target),
    );
  });

  it("returns undefined when the extension context is unavailable", () => {
    sdk.getExtensionContext.mockImplementation(() => {
      throw new Error("not initialized");
    });
    expect(buildHubDeepLinkUrl(doc, target)).toBeUndefined();
  });
});

describe("resolveOrgUrl", () => {
  it("uses the host name when available", () => {
    sdk.getHost.mockReturnValue({ name: "contoso" });
    expect(resolveOrgUrl()).toBe("https://dev.azure.com/contoso");
  });

  it("falls back to the referrer heuristic", () => {
    sdk.getHost.mockReturnValueOnce(undefined);
    const fromReferrer = resolveOrgUrl();
    sdk.getHost.mockImplementationOnce(() => {
      throw new Error("not initialized");
    });
    expect(resolveOrgUrl()).toBe(fromReferrer);
    sdk.getHost.mockReturnValueOnce({ name: "" });
    expect(resolveOrgUrl()).toBe(fromReferrer);
  });
});

describe("readCurrentUser", () => {
  it("projects the SDK user onto a comment author", () => {
    sdk.getUser.mockReturnValue({
      id: "u1",
      displayName: "Ada Lovelace",
      imageUrl: "",
    });
    const user = readCurrentUser();
    expect(user.id).toBe("u1");
    expect(user.displayName).toBe("Ada Lovelace");
    expect(user.initials).toBe("AL");
  });
});
