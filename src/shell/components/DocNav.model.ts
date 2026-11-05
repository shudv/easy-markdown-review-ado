// Shared DocNav model: node/heading types, row contexts, and pure helpers.

import { createContext } from "react";

import type { ChangeType, FileInfo } from "../../types";

/**
 * Whether file rows should render change-type indicators. Provided by DocNav so
 * the deeply-nested `FileNavRow` / `SearchResultsList` renderers can read it
 * without drilling the flag through the recursive `NavTreeItem` tree. Defaults
 * to `true` so any renderer used outside a Provider keeps the PR-tab behaviour.
 */
export const ChangeIndicatorContext = createContext<boolean>(true);

/** Files a comparison of PR updates touches; see `DocNavProps.rangeChanges`. */
export interface RangeChanges {
  /** e.g. "Update 4 → 5". */
  label: string;
  /** Change type within the comparison, keyed by repo path. */
  byPath: Readonly<Partial<Record<string, ChangeType>>>;
}

/** The active `RangeChanges`, read by the nested file-row renderers. */
export const RangeChangesContext = createContext<RangeChanges | undefined>(
  undefined,
);

/**
 * How a file row presents its change: within the selected updates when a
 * comparison is active (dimmed when untouched), else its PR-wide change.
 */
export function fileChangeView(
  file: FileInfo,
  rangeChanges: RangeChanges | undefined,
): { changeType: ChangeType; unchanged: boolean; note?: string } {
  if (!rangeChanges) return { changeType: file.changeType, unchanged: false };
  const inRange = rangeChanges.byPath[file.path];
  return inRange !== undefined
    ? { changeType: inRange, unchanged: false }
    : {
        changeType: file.changeType,
        unchanged: true,
        note: `No changes in ${rangeChanges.label}`,
      };
}

export interface NavHeading {
  id: string;
  text: string;
  level: number;
  topPx: number;
  /** Number of unresolved threads anchored inside this heading's section. */
  openComments: number;
  /** Total number of threads (any status) anchored inside this section. */
  totalComments: number;
}

/** A node in the rendered tree: the folder/file tree plus the heading sub-tree
 *  under the selected file, with a "lazy-dir" kind for unenumerated folders. */
export type NavNode =
  | {
      kind: "dir";
      path: string;
      displayName: string;
      children: NavNode[];
      /** True when the folder is unenumerated; chevron triggers a fetch. */
      lazy?: boolean;
      /** The folder's own wiki page (a page with subpages). */
      page?: { file: FileInfo; openComments: number };
      /**
       * The open page's heading outline. Always shown under the row, apart
       * from the subpages the chevron shows or hides.
       */
      outline?: NavNode[];
    }
  | {
      kind: "file";
      file: FileInfo;
      openComments: number;
      children: NavNode[];
    }
  | { kind: "heading"; heading: NavHeading; children: NavNode[] };

export type DirNavNode = Extract<NavNode, { kind: "dir" }>;

export function basename(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? p : p.slice(idx + 1);
}

export function changeTypeGlyph(t: ChangeType): string {
  switch (t) {
    case "added":
      return "A";
    case "modified":
      return "M";
    case "renamed":
      return "R";
    case "deleted":
      return "D";
  }
}

/** Tiny CSS.escape polyfill so we don't pull a dep. */
export function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  return s.replace(/([^\w-])/g, "\\$1");
}

/** The heading that's active in the nav: none while the outline is off. */
export function shownActiveHeading(
  outlineShown: boolean,
  activeId: string | null,
): string | null {
  return outlineShown ? activeId : null;
}

/**
 * Stable React list key for every NavNode kind. Dir paths, file paths (always
 * carry an extension), and slug-prefixed heading ids cannot collide.
 */
export function navNodeKey(node: NavNode): string {
  if (node.kind === "dir") return `dir:${node.path}`;
  if (node.kind === "file") return `file:${node.file.path}`;
  return `heading:${node.heading.id}`;
}

/**
 * Return every ancestor folder path a file lives under, used to auto-expand
 * the selected file's parents.
 *
 *   pathAncestors("docs/api/v2/auth.md")
 *     → ["docs", "docs/api", "docs/api/v2"]
 */
export function pathAncestors(path: string): string[] {
  const segments = path.replace(/^\/+/, "").split("/").filter(Boolean);
  if (segments.length <= 1) return [];
  const out: string[] = [];
  let acc = "";
  for (let i = 0; i < segments.length - 1; i += 1) {
    acc = acc ? `${acc}/${segments[i]!}` : segments[i]!;
    out.push(acc);
  }
  return out;
}
