import { describe, it, expect } from "vitest";

import {
  buildFolderTree,
  collectDirPaths,
  mergeWikiPages,
  normalizeFolderPath,
  type TreeNode,
} from "../src/shell/components/folderTree";

interface F {
  path: string;
}

function pp<N extends F>(nodes: ReadonlyArray<TreeNode<N>>, depth = 0): string {
  // Compact pretty-print for snapshot-style assertions.
  let out = "";
  for (const n of nodes) {
    const pad = "  ".repeat(depth);
    if (n.kind === "dir") {
      out += `${pad}DIR ${n.displayName} (${n.path})\n`;
      out += pp(n.children, depth + 1);
    } else {
      out += `${pad}FILE ${n.file.path}\n`;
    }
  }
  return out;
}

describe("buildFolderTree", () => {
  it("returns an empty array for no files", () => {
    expect(buildFolderTree([])).toEqual([]);
  });

  it("skips files whose path is only slashes", () => {
    // `"/"` strips to no segments, so the file contributes nothing.
    expect(buildFolderTree<F>([{ path: "/" }])).toEqual([]);
  });

  it("puts a single root-level file at the top", () => {
    const tree = buildFolderTree<F>([{ path: "readme.md" }]);
    expect(tree).toEqual([{ kind: "file", file: { path: "readme.md" } }]);
  });

  it("creates one dir per nested folder for diverging paths", () => {
    const tree = buildFolderTree<F>([
      { path: "docs/api.md" },
      { path: "docs/guide.md" },
    ]);
    // Two files share `docs/`, so `docs/` is one dir with two file children.
    expect(pp(tree)).toBe(
      [
        "DIR docs (docs)",
        "  FILE docs/api.md",
        "  FILE docs/guide.md",
        "",
      ].join("\n"),
    );
  });

  it("collapses a chain of single-child folders into one node", () => {
    const tree = buildFolderTree<F>([
      { path: "docs/api/v2/specs/auth.md" },
      { path: "docs/api/v2/specs/sso.md" },
    ]);
    // The two leaves share `docs/api/v2/specs/`, so the three intermediate
    // single-child folders collapse into one row labelled
    // `docs/api/v2/specs`.
    expect(pp(tree)).toBe(
      [
        "DIR docs/api/v2/specs (docs/api/v2/specs)",
        "  FILE docs/api/v2/specs/auth.md",
        "  FILE docs/api/v2/specs/sso.md",
        "",
      ].join("\n"),
    );
  });

  it("stops collapsing at a fork", () => {
    const tree = buildFolderTree<F>([
      { path: "docs/api/v2/foo.md" },
      { path: "docs/api/v2/bar.md" },
      { path: "docs/legal/terms.md" },
    ]);
    // `docs/` cannot collapse — it has two child folders (`api` and `legal`).
    // `docs/api/v2/` collapses because each intermediate has exactly one
    // child folder. `docs/legal/` stays a single folder.
    expect(pp(tree)).toBe(
      [
        "DIR docs (docs)",
        "  DIR api/v2 (docs/api/v2)",
        "    FILE docs/api/v2/bar.md",
        "    FILE docs/api/v2/foo.md",
        "  DIR legal (docs/legal)",
        "    FILE docs/legal/terms.md",
        "",
      ].join("\n"),
    );
  });

  it("does NOT collapse a folder that also contains a file", () => {
    const tree = buildFolderTree<F>([
      { path: "docs/index.md" },
      { path: "docs/specs/auth.md" },
    ]);
    // `docs/` has a file child AND a folder child — collapsing would lose
    // the index file's home, so we keep both folders distinct.
    expect(pp(tree)).toBe(
      [
        "DIR docs (docs)",
        "  DIR specs (docs/specs)",
        "    FILE docs/specs/auth.md",
        "  FILE docs/index.md",
        "",
      ].join("\n"),
    );
  });

  it("ignores leading slashes and double slashes", () => {
    const tree = buildFolderTree<F>([
      { path: "/docs/a.md" },
      { path: "docs//b.md" },
    ]);
    expect(pp(tree)).toBe(
      ["DIR docs (docs)", "  FILE /docs/a.md", "  FILE docs//b.md", ""].join(
        "\n",
      ),
    );
  });

  it("sorts folders before files alphabetically (case-insensitive)", () => {
    const tree = buildFolderTree<F>([
      { path: "zeta.md" },
      { path: "Alpha.md" },
      { path: "src/a.md" },
      { path: "Bravo.md" },
    ]);
    const names = tree.map((n) =>
      n.kind === "dir" ? n.displayName : n.file.path,
    );
    expect(names).toEqual(["src", "Alpha.md", "Bravo.md", "zeta.md"]);
  });

  it("emits all dir paths via collectDirPaths", () => {
    const tree = buildFolderTree<F>([
      { path: "docs/api/v2/specs/auth.md" },
      { path: "docs/api/v2/specs/sso.md" },
      { path: "docs/index.md" },
    ]);
    expect(collectDirPaths(tree).sort()).toEqual(
      ["docs", "docs/api/v2/specs"].sort(),
    );
  });
});

describe("buildFolderTree — extraFolders (lazy branches)", () => {
  it("surfaces a known-but-unloaded folder with no file children", () => {
    const tree = buildFolderTree<F>([], { extraFolders: ["docs/api"] });
    expect(pp(tree)).toBe(["DIR docs/api (docs/api)", ""].join("\n"));
  });

  it("collapses a multi-segment lazy folder into one row", () => {
    const tree = buildFolderTree<F>([], {
      extraFolders: ["a/b/c"],
    });
    expect(pp(tree)).toBe(["DIR a/b/c (a/b/c)", ""].join("\n"));
  });

  it("merges a lazy folder into a populated one without duplicating it", () => {
    const tree = buildFolderTree<F>([{ path: "docs/readme.md" }], {
      extraFolders: ["docs"],
    });
    // The real file wins; `docs` appears once with its file child.
    expect(pp(tree)).toBe(
      ["DIR docs (docs)", "  FILE docs/readme.md", ""].join("\n"),
    );
  });

  it("normalises leading/trailing slashes on lazy folder paths", () => {
    const tree = buildFolderTree<F>([], { extraFolders: ["/docs/api/"] });
    expect(pp(tree)).toBe(["DIR docs/api (docs/api)", ""].join("\n"));
  });

  it("ignores an empty lazy folder path", () => {
    const tree = buildFolderTree<F>([{ path: "a.md" }], {
      extraFolders: ["///"],
    });
    expect(pp(tree)).toBe(["FILE a.md", ""].join("\n"));
  });

  it("lists lazy folder paths via collectDirPaths", () => {
    const tree = buildFolderTree<F>([], { extraFolders: ["docs/api"] });
    expect(collectDirPaths(tree)).toEqual(["docs/api"]);
  });
});

describe("buildFolderTree — wiki .order", () => {
  const files: F[] = [
    { path: "/Zeta.md" },
    { path: "/Overview.md" },
    { path: "/Guides.md" },
    { path: "/Guides/Install.md" },
    { path: "/Guides/Configure.md" },
    { path: "/Guides/Advanced.md" },
    { path: "/Archive/2020/notes.md" },
    { path: "/Archive/2021/notes.md" },
  ];

  it("sorts listed pages and folders first, in .order order", () => {
    const tree = buildFolderTree<F>(files, {
      folderOrders: {
        "": ["Overview", "Guides", "Zeta"],
        Guides: ["Install", "Configure"],
      },
    });
    // Root: Overview, then the Guides page + its subpage folder (folder
    // first, as elsewhere), then Zeta; the unlisted Archive folder follows.
    expect(pp(tree)).toBe(
      [
        "FILE /Overview.md",
        "DIR Guides (Guides)",
        "  FILE /Guides/Install.md",
        "  FILE /Guides/Configure.md",
        "  FILE /Guides/Advanced.md",
        "FILE /Guides.md",
        "FILE /Zeta.md",
        "DIR Archive (Archive)",
        "  DIR 2020 (Archive/2020)",
        "    FILE /Archive/2020/notes.md",
        "  DIR 2021 (Archive/2021)",
        "    FILE /Archive/2021/notes.md",
        "",
      ].join("\n"),
    );
  });

  it("orders a collapsed folder chain by its first segment", () => {
    const tree = buildFolderTree<F>(
      [{ path: "a.md" }, { path: "deep/er/x.md" }, { path: "deep/er/y.md" }],
      { folderOrders: { "": ["deep", "a"] } },
    );
    expect(pp(tree)).toBe(
      [
        "DIR deep/er (deep/er)",
        "  FILE deep/er/x.md",
        "  FILE deep/er/y.md",
        "FILE a.md",
        "",
      ].join("\n"),
    );
  });

  it("keeps the default order for folders without an .order", () => {
    const withOrders = buildFolderTree<F>(files, { folderOrders: {} });
    expect(pp(withOrders)).toBe(pp(buildFolderTree<F>(files)));
  });

  it("ignores inherited properties for folders named like them", () => {
    const named: F[] = ["constructor", "__proto__", "toString"].flatMap(
      (folder) => [{ path: `/${folder}/b.md` }, { path: `/${folder}/a.md` }],
    );
    const tree = buildFolderTree<F>(named, {
      folderOrders: { toString: ["b"] },
    });
    expect(pp(tree)).toBe(
      [
        "DIR __proto__ (__proto__)",
        "  FILE /__proto__/a.md",
        "  FILE /__proto__/b.md",
        "DIR constructor (constructor)",
        "  FILE /constructor/a.md",
        "  FILE /constructor/b.md",
        "DIR toString (toString)",
        "  FILE /toString/b.md",
        "  FILE /toString/a.md",
        "",
      ].join("\n"),
    );
  });
});

describe("normalizeFolderPath", () => {
  it("strips a leading slash (ADO-shaped paths)", () => {
    expect(normalizeFolderPath("/docs")).toBe("docs");
  });

  it("strips a trailing slash", () => {
    expect(normalizeFolderPath("docs/")).toBe("docs");
  });

  it("strips both leading and trailing slashes", () => {
    expect(normalizeFolderPath("/docs/api/")).toBe("docs/api");
  });

  it("leaves an already-bare path untouched", () => {
    expect(normalizeFolderPath("docs/api")).toBe("docs/api");
  });
});

describe("mergeWikiPages", () => {
  /** Pretty-print with merged pages shown as `PAGE+DIR`. */
  function ppMerged(nodes: ReadonlyArray<TreeNode<F>>, depth = 0): string {
    let out = "";
    for (const n of nodes) {
      const pad = "  ".repeat(depth);
      if (n.kind === "dir") {
        out += n.page
          ? `${pad}PAGE+DIR ${n.displayName} (${n.page.path})\n`
          : `${pad}DIR ${n.displayName}\n`;
        out += ppMerged(n.children, depth + 1);
      } else {
        out += `${pad}FILE ${n.file.path}\n`;
      }
    }
    return out;
  }

  it("folds a page into its same-named subpage folder, at every level", () => {
    const tree = mergeWikiPages(
      buildFolderTree<F>([
        { path: "/Home.md" },
        { path: "/Guides.md" },
        { path: "/Guides/Install.md" },
        { path: "/Guides/Install/Linux.md" },
        { path: "/Guides/Install/Windows.md" },
        { path: "/Guides/Configure.md" },
      ]),
    );
    expect(ppMerged(tree)).toBe(
      [
        "PAGE+DIR Guides (/Guides.md)",
        "  PAGE+DIR Install (/Guides/Install.md)",
        "    FILE /Guides/Install/Linux.md",
        "    FILE /Guides/Install/Windows.md",
        "  FILE /Guides/Configure.md",
        "FILE /Home.md",
        "",
      ].join("\n"),
    );
  });

  it("keeps folders without a page, and pages without a folder, as they are", () => {
    const tree = mergeWikiPages(
      buildFolderTree<F>([{ path: "/Archive/old.md" }, { path: "/Notes.md" }], {
        extraFolders: ["/Lazy"],
      }),
    );
    expect(ppMerged(tree)).toBe(
      [
        "DIR Archive",
        "  FILE /Archive/old.md",
        "DIR Lazy",
        "FILE /Notes.md",
        "",
      ].join("\n"),
    );
  });

  it("merges a not-yet-loaded subpage folder with its page", () => {
    const tree = mergeWikiPages(
      buildFolderTree<F>([{ path: "/Guides.md" }], {
        extraFolders: ["/Guides"],
      }),
    );
    expect(ppMerged(tree)).toBe("PAGE+DIR Guides (/Guides.md)\n");
  });

  it("matches page names exactly and ignores non-Markdown files", () => {
    const tree = mergeWikiPages(
      buildFolderTree<F>([
        { path: "/guides.md" },
        { path: "/Guides/a.md" },
        { path: "/Assets.txt" },
        { path: "/Assets/logo.md" },
      ]),
    );
    expect(ppMerged(tree)).toBe(
      [
        "DIR Assets",
        "  FILE /Assets/logo.md",
        "DIR Guides",
        "  FILE /Guides/a.md",
        "FILE /Assets.txt",
        "FILE /guides.md",
        "",
      ].join("\n"),
    );
  });

  it("doesn't merge a collapsed folder chain", () => {
    const tree = mergeWikiPages(
      buildFolderTree<F>([{ path: "/a.md" }, { path: "/a/b/c.md" }]),
    );
    expect(ppMerged(tree)).toBe(
      ["DIR a/b", "  FILE /a/b/c.md", "FILE /a.md", ""].join("\n"),
    );
  });
});
