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
        expect(parseOrderFile("Overview\r\n  Getting-Started \n\n\rFAQ\n")).toEqual([
            "Overview",
            "Getting-Started",
            "FAQ",
        ]);
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
    const rank = orderRank(["Overview", "Guides/", "FAQ.md"]);

    it.each([
        { name: "a listed page", page: "Overview", expected: 0 },
        { name: "a folder listed with a trailing slash", page: "Guides", expected: 1 },
        { name: "a page listed with its .md extension", page: "FAQ", expected: 2 },
        { name: "an unlisted page, last", page: "Other", expected: Infinity },
    ])("ranks $name by its position", ({ page, expected }) => {
        expect(rank(page)).toBe(expected);
    });

    it.each([
        {
            name: "an exact-case match over an earlier case-insensitive one",
            page: "FAQ",
            expected: 1,
        },
        { name: "the first case-insensitive match when none is exact", page: "Faq", expected: 0 },
        { name: "an exact-case match listed later", page: "intro", expected: 3 },
    ])("prefers $name", ({ page, expected }) => {
        expect(orderRank(["faq", "FAQ", "Intro", "intro"])(page)).toBe(expected);
    });

    it("ranks everything unlisted without an order", () => {
        expect(orderRank(undefined)("Anything")).toBe(Infinity);
    });

    it("keeps the first position of a repeated entry", () => {
        expect(orderRank(["A", "B", "A"])("A")).toBe(0);
    });

    it.each([
        { name: "an earlier rank first", a: 0, b: 1, expected: -1 },
        { name: "a later rank after", a: 2, b: 1, expected: 1 },
        { name: "two unlisted pages as tied", a: Infinity, b: Infinity, expected: 0 },
    ])("compares $name", ({ a, b, expected }) => {
        expect(compareRanks(a, b)).toBe(expected);
    });
});

describe("withFirstPageFirst", () => {
    const files = ["/Guides.md", "/Guides/Install.md", "/Home.md", "/Zeta.md"].map(file);

    it("moves the root .order's first present page to the front", () => {
        expect(withFirstPageFirst(files, ["Missing", "Home", "Guides"]).map((f) => f.path)).toEqual(
            ["/Home.md", "/Guides.md", "/Guides/Install.md", "/Zeta.md"],
        );
    });

    it("only considers root pages", () => {
        expect(withFirstPageFirst(files, ["Install", "Zeta"]).map((f) => f.path)).toEqual([
            "/Zeta.md",
            "/Guides.md",
            "/Guides/Install.md",
            "/Home.md",
        ]);
    });

    it.each([
        { name: "there is no root order", order: undefined },
        { name: "no listed page exists", order: ["Missing"] },
    ])("leaves the files as they are when $name", ({ order }) => {
        expect(withFirstPageFirst(files, order)).toBe(files);
    });
});

describe("subpagesFolderOf", () => {
    it.each([
        ["/Guides.md", "/Guides"],
        ["/a/Page.MD", "/a/Page"],
    ])("finds the subpages of %s in %s", (page, folder) => {
        expect(subpagesFolderOf(page)).toBe(folder);
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
