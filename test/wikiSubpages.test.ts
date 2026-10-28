// Loading a wiki page's subpages for its `[[_TOSP_]]` table.

import { describe, expect, it, vi } from "vitest";

import { loadWikiSubpages } from "../src/shell/wikiSubpages";

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

  it("is unavailable (not empty) when the listing fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      loadWikiSubpages("/Guides.md", async () => {
        throw new Error("403 Forbidden");
      }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
