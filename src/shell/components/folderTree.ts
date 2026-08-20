// Build a hierarchical folder/file tree from a flat list of file paths.
//
// Used by the DocNav to render an Azure-DevOps-style file explorer. Two
// things make this non-trivial:
//
//   1. Empty intermediate folders should collapse into a single node.
//      Given files at `docs/api/v2/foo.md` and `docs/api/v2/bar.md` we
//      want a single row labelled `docs/api/v2/` rather than three
//      separately-clickable rows. The collapsed name is the joined
//      segments separated by `/`.
//   2. Sort is folder-first, alphabetical, with paths compared as
//      lower-case so `Architecture.md` and `architecture.md` group as
//      neighbours. Within a folder, files sort after sub-folders.
//
// The tree-building is intentionally `FileInfo`-agnostic — callers pass
// any object with a `path` and get back nodes that wrap the original
// reference. This lets the DocNav reuse the same nodes for both PR-tab
// files (which carry `changeType` + diff stats) and Documents-hub files
// (plain `path` only) without needing two trees.

export interface DirNode<F extends { path: string }> {
  kind: "dir";
  /** Full path of the deepest folder this node represents, e.g. "docs/api/v2". */
  path: string;
  /** Display label: the collapsed segments separated by `/`. */
  displayName: string;
  children: Array<DirNode<F> | FileNode<F>>;
}

export interface FileNode<F extends { path: string }> {
  kind: "file";
  file: F;
}

export type TreeNode<F extends { path: string }> = DirNode<F> | FileNode<F>;

/**
 * Canonicalize a folder path to the slash-free form used as the tree's
 * dir-node `path`. ADO returns paths with a leading slash (`/docs`) while
 * other call sites pass them bare (`docs`); stripping leading/trailing
 * slashes makes the two interchangeable as map/set keys.
 */
export function normalizeFolderPath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * Build a sorted, collapsed folder/file tree from a flat list. The
 * input `files` does not need to be pre-sorted; the output is folder-
 * first, alphabetical (case-insensitive).
 *
 * `options.extraFolders` lets the caller surface folders that are known
 * to exist but whose contents haven't been loaded yet (e.g. the
 * Documents hub's lazy-load mode). Each extra folder path is added as
 * an empty branch in the tree; the DocNav decorates these as
 * expandable rows that trigger a fetch on first open. If an
 * `extraFolders` path overlaps with the parent of a real `files`
 * entry, the real entry wins (the lazy branch silently merges into
 * the populated one).
 */
export function buildFolderTree<F extends { path: string }>(
  files: readonly F[],
  options?: { extraFolders?: readonly string[] },
): Array<TreeNode<F>> {
  // Internal building shape: keep children in a Map keyed by segment name
  // so insertion is O(1). We flatten to arrays + sort at the end.
  interface Building {
    name: string;
    full: string;
    children: Map<string, Building>;
    file?: F;
  }
  const root: Building = { name: "", full: "", children: new Map() };

  for (const f of files) {
    // Strip leading slash so `"/docs/foo.md"` and `"docs/foo.md"` give
    // identical trees. Empty segments (caused by `//` or trailing `/`)
    // are filtered out.
    const segments = f.path.replace(/^\/+/, "").split("/").filter(Boolean);
    if (segments.length === 0) continue;

    let cursor = root;
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i]!;
      const isLeaf = i === segments.length - 1;
      const existing = cursor.children.get(seg);
      if (existing) {
        cursor = existing;
      } else {
        const next: Building = {
          name: seg,
          full: cursor.full ? `${cursor.full}/${seg}` : seg,
          children: new Map(),
        };
        cursor.children.set(seg, next);
        cursor = next;
      }
      if (isLeaf) {
        cursor.file = f;
      }
    }
  }

  // Inject any known-but-unloaded folder paths as empty branches. Each
  // path becomes a chain of `Building` nodes ending in a childless
  // folder; the collapse pass below folds long chains into a single
  // visible row.
  for (const folderPath of options?.extraFolders ?? []) {
    const segments = normalizeFolderPath(folderPath).split("/").filter(Boolean);
    if (segments.length === 0) continue;
    let cursor = root;
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i]!;
      const existing = cursor.children.get(seg);
      if (existing) {
        cursor = existing;
      } else {
        const next: Building = {
          name: seg,
          full: cursor.full ? `${cursor.full}/${seg}` : seg,
          children: new Map(),
        };
        cursor.children.set(seg, next);
        cursor = next;
      }
    }
    // No `cursor.file = …` here — that's what makes this a lazy folder.
  }

  // Convert + collapse: for every `Building` we visit, if it is a folder
  // (no file) with exactly one child that is also a folder, merge into a
  // single node and recurse. Stops as soon as we hit a folder whose
  // single child is a file, or a folder with !=1 children.
  function build(node: Building): TreeNode<F> {
    if (node.file && node.children.size === 0) {
      return { kind: "file", file: node.file };
    }
    // Collapse: while this folder has exactly one child folder and no
    // file-of-its-own, fold that child up into ourselves. We accumulate
    // the display segments so the rendered label reflects the full
    // collapsed path.
    const displaySegments = [node.name];
    let work = node;
    while (
      work.file === undefined &&
      work.children.size === 1 &&
      [...work.children.values()][0]!.file === undefined
    ) {
      const onlyChild = [...work.children.values()][0]!;
      displaySegments.push(onlyChild.name);
      work = onlyChild;
    }
    const children: TreeNode<F>[] = [];
    for (const child of work.children.values()) {
      children.push(build(child));
    }
    sortNodes(children);
    return {
      kind: "dir",
      path: work.full,
      displayName: displaySegments.join("/"),
      children,
    };
  }

  const roots: TreeNode<F>[] = [];
  for (const child of root.children.values()) {
    roots.push(build(child));
  }
  sortNodes(roots);
  return roots;
}

function sortNodes<F extends { path: string }>(nodes: TreeNode<F>[]): void {
  nodes.sort((a, b) => {
    const aDir = a.kind === "dir";
    const bDir = b.kind === "dir";
    if (aDir && !bDir) return -1;
    if (!aDir && bDir) return 1;
    const an = a.kind === "dir" ? a.displayName : basename(a.file.path);
    const bn = b.kind === "dir" ? b.displayName : basename(b.file.path);
    return an.toLowerCase().localeCompare(bn.toLowerCase());
  });
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

/**
 * Walk the tree and collect every dir path. Used by `<DocNav>` to know
 * which folder rows can be expanded/collapsed.
 */
export function collectDirPaths<F extends { path: string }>(
  nodes: ReadonlyArray<TreeNode<F>>,
): string[] {
  const out: string[] = [];
  function walk(n: TreeNode<F>): void {
    if (n.kind === "dir") {
      out.push(n.path);
      for (const c of n.children) walk(c);
    }
  }
  for (const n of nodes) walk(n);
  return out;
}
