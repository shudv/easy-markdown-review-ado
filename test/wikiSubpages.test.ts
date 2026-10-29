// Loading a wiki page's subpages for its `[[_TOSP_]]` table.

import { describe, expect, it, vi } from "vitest";

import { loadWikiSubpages, subpagesCommit } from "../src/shell/wikiSubpages";

const trackUserFacingErrorMock = vi.fn();
vi.mock("../src/telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/telemetry")>();
  return {
    ...actual,
    trackUserFacingError: (...args: unknown[]) =>
      trackUserFacingErrorMock(...args),
  };
});

describe("loadWikiSubpages", () => {
  it("lists the page's subpage folder, in .order order", async () => {
    const listFolder = vi.fn(async () => ({
      files: ["/Guides/Configure.md", "/Guides/Install.md"].map((path) => ({
        path,
        changeType: "modified" as const,
        linesAdded: 0,
        linesDeleted: 0,
      })),
      folders: [],
      order: ["Install"],
    }));
    await expect(loadWikiSubpages("/Guides.md", listFolder)).resolves.toEqual([
      { path: "/Guides/Install.md", title: "Install" },
      { path: "/Guides/Configure.md", title: "Configure" },
    ]);
    expect(listFolder).toHaveBeenCalledWith("/Guides", undefined);
  });

  it("lists a historical version's subpages at that version's commit", async () => {
    const listFolder = vi.fn(async () => ({ files: [], folders: [] }));
    await expect(
      loadWikiSubpages("/Guides.md", listFolder, "abc123"),
    ).resolves.toEqual([]);
    expect(listFolder).toHaveBeenCalledWith("/Guides", "abc123");
  });

  it("is unavailable (not empty) when the listing fails, and reports it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failure = new Error("403 Forbidden");
    await expect(
      loadWikiSubpages("/Guides.md", async () => {
        throw failure;
      }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[wiki] listing subpages failed:",
      failure,
    );
    expect(trackUserFacingErrorMock).toHaveBeenCalledWith({
      error: failure,
      source: "PrShell.subpages",
      operation: "subpages-load",
      impact: "degraded",
    });
    warn.mockRestore();
  });
});

describe("subpagesCommit", () => {
  it("lists the current version at the branch head", () => {
    expect(subpagesCommit(false, "abc")).toBeUndefined();
  });

  it("lists a historical version at its own commit", () => {
    expect(subpagesCommit(true, "abc")).toBe("abc");
  });

  it("can't list a historical version without a commit", () => {
    expect(subpagesCommit(true, null)).toBeNull();
    expect(subpagesCommit(true, undefined)).toBeNull();
  });
});
