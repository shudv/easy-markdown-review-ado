// Azure DevOps wiki `.order` files, page titles, and subpage listings.

import { describe, expect, it } from "vitest";

import {
  compareRanks,
  orderRank,
  parseOrderFile,
  subpagesFolderOf,
  subpagesFromListing,
  wikiPageName,
  wikiPageTitle,
  withFirstPageFirst,
} from "../src/shell/wikiOrder";
import type { FileInfo } from "../src/types";

function file(path: string): FileInfo {
  return { path, changeType: "modified", linesAdded: 0, linesDeleted: 0 };
}

describe("parseOrderFile", () => {
  it("lists one trimmed page name per non-blank line", () => {
    expect(parseOrderFile("Overview\r\n  Getting-Started \n\n\rFAQ\n")).toEqual(
      ["Overview", "Getting-Started", "FAQ"],
    );
  });

  it("is empty for an empty file", () => {
    expect(parseOrderFile("")).toEqual([]);
  });

  it("drops a leading byte-order mark, so the first page still matches", () => {
    const order = parseOrderFile("\uFEFFHome\r\nGuides\r\n");
    expect(order).toEqual(["Home", "Guides"]);
    expect(orderRank(order)("Home")).toBe(0);
  });
});

describe("wikiPageName", () => {
  it.each([
    ["/Guides/Getting-Started.md", "Getting-Started"],
    ["Getting-Started", "Getting-Started"],
    ["Guides/", "Guides"],
    ["/Guides/Notes.MD", "Notes"],
    ["", ""],
    ["/", ""],
  ])("%j → %j", (input, expected) => {
    expect(wikiPageName(input)).toBe(expected);
  });
});

describe("wikiPageTitle", () => {
  it.each([
    ["/How-to-contribute.md", "How to contribute"],
    ["/Setup%2DGuide.md", "Setup-Guide"],
    ["/FAQ%3A0525.md", "FAQ:0525"],
    ["/100%-done.md", "100% done"],
  ])("%j → %j", (path, expected) => {
    expect(wikiPageTitle(path)).toBe(expected);
  });
});

describe("orderRank / compareRanks", () => {
  it("ranks listed names by position and unlisted names last", () => {
    const rank = orderRank(["Overview", "Guides/", "FAQ.md"]);
    expect(rank("Overview")).toBe(0);
    expect(rank("Guides")).toBe(1);
    expect(rank("FAQ")).toBe(2);
    expect(rank("Other")).toBe(Infinity);
  });

  it("prefers an exact match, then falls back to case-insensitive", () => {
    const rank = orderRank(["faq", "FAQ", "Intro", "intro"]);
    expect(rank("FAQ")).toBe(1);
    expect(rank("Faq")).toBe(0);
    expect(rank("intro")).toBe(3);
  });

  it("ranks everything unlisted without an order", () => {
    expect(orderRank(undefined)("Anything")).toBe(Infinity);
  });

  it("keeps the first position of a repeated entry", () => {
    expect(orderRank(["A", "B", "A"])("A")).toBe(0);
  });

  it("compares ranks with ties at zero", () => {
    expect(compareRanks(0, 1)).toBe(-1);
    expect(compareRanks(2, 1)).toBe(1);
    expect(compareRanks(Infinity, Infinity)).toBe(0);
  });
});

describe("withFirstPageFirst", () => {
  const files = [
    "/Guides.md",
    "/Guides/Install.md",
    "/Home.md",
    "/Zeta.md",
  ].map(file);

  it("moves the root .order's first present page to the front", () => {
    expect(
      withFirstPageFirst(files, ["Missing", "Home", "Guides"]).map(
        (f) => f.path,
      ),
    ).toEqual(["/Home.md", "/Guides.md", "/Guides/Install.md", "/Zeta.md"]);
  });

  it("only considers root pages", () => {
    expect(
      withFirstPageFirst(files, ["Install", "Zeta"]).map((f) => f.path),
    ).toEqual(["/Zeta.md", "/Guides.md", "/Guides/Install.md", "/Home.md"]);
  });

  it("leaves the files as they are without a usable root order", () => {
    expect(withFirstPageFirst(files, undefined)).toBe(files);
    expect(withFirstPageFirst(files, ["Missing"])).toBe(files);
  });
});

describe("subpagesFolderOf", () => {
  it("drops the page's .md extension", () => {
    expect(subpagesFolderOf("/Guides.md")).toBe("/Guides");
    expect(subpagesFolderOf("/a/Page.MD")).toBe("/a/Page");
  });
});

describe("subpagesFromListing", () => {
  it("orders pages by .order, then the rest by title", () => {
    const subpages = subpagesFromListing({
      files: [
        file("/Guides/zeta.md"),
        file("/Guides/Alpha.md"),
        file("/Guides/Install.md"),
        file("/Guides/Getting-Started.md"),
      ],
      folders: ["/Guides/Install"],
      order: ["Install", "Getting-Started", "Missing"],
    });
    expect(subpages).toEqual([
      { path: "/Guides/Install.md", title: "Install" },
      { path: "/Guides/Getting-Started.md", title: "Getting Started" },
      { path: "/Guides/Alpha.md", title: "Alpha" },
      { path: "/Guides/zeta.md", title: "zeta" },
    ]);
  });

  it("sorts alphabetically without an .order", () => {
    expect(
      subpagesFromListing({
        files: [file("/b.md"), file("/A.md")],
        folders: [],
      }).map((page) => page.title),
    ).toEqual(["A", "b"]);
  });
});
