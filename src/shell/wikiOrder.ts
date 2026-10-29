// Azure DevOps wiki page order and subpages.
//
// An Azure DevOps wiki repository orders each folder's pages with a `.order`
// file: one page name per line (the file name without `.md`, e.g.
// `Getting-Started`). A page `Foo.md` keeps its subpages in the sibling folder
// `Foo/`, so a page and its subpage folder share one name. Entries not listed
// in `.order` follow the listed ones in the default (alphabetical) order.
// Page titles come from file names: `-` stands for a space and other special
// characters are percent-encoded (`FAQ%3A0525.md` is the page "FAQ:0525").

import type { WikiSubpage } from "../markdown/wikiMacros";
import type { FolderListing } from "./types";

/**
 * Lists one folder of the repository (Markdown pages, subfolders, order) —
 * as of `atCommitId` when given (a historical version of a document), else as
 * the host's current version.
 */
export type FolderLister = (
  folderPath: string,
  atCommitId?: string,
) => Promise<FolderListing>;

/** File name of a folder's wiki page order. */
export const ORDER_FILE_NAME = ".order";

/** The page names a `.order` file lists, in order. */
export function parseOrderFile(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * The wiki page name of a path or `.order` entry: its last segment without a
 * trailing slash or `.md` extension.
 */
export function wikiPageName(pathOrName: string): string {
  const segments = pathOrName.split("/").filter(Boolean);
  return (segments[segments.length - 1] ?? "").replace(/\.md$/i, "");
}

/** The display title of a wiki page file. */
export function wikiPageTitle(path: string): string {
  const name = wikiPageName(path).replace(/-/g, " ");
  try {
    return decodeURIComponent(name);
  } catch {
    // A stray `%` that isn't an escape — show the name as written.
    return name;
  }
}

/**
 * Rank lookup for a folder's `.order`: the position of a page name in it, or
 * `Infinity` when unlisted. Matches exactly first, then case-insensitively.
 */
export function orderRank(
  order: readonly string[] | undefined,
): (name: string) => number {
  const exact = new Map<string, number>();
  const folded = new Map<string, number>();
  (order ?? []).forEach((entry, index) => {
    const name = wikiPageName(entry);
    if (!exact.has(name)) exact.set(name, index);
    const lower = name.toLowerCase();
    if (!folded.has(lower)) folded.set(lower, index);
  });
  return (name) =>
    exact.get(name) ?? folded.get(name.toLowerCase()) ?? Infinity;
}

/** Compare two ranks; equal ranks (including two unlisted) tie at 0. */
export function compareRanks(a: number, b: number): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * `files` with the wiki's first root page (by the root folder's `.order`)
 * moved to the front, so opening a repo lands on the page the wiki opens
 * first. Unchanged without a root order or when no listed root page exists.
 */
export function withFirstPageFirst<F extends { path: string }>(
  files: F[],
  rootOrder: readonly string[] | undefined,
): F[] {
  const rank = orderRank(rootOrder);
  let first: F | undefined;
  let best = Infinity;
  for (const file of files) {
    if (file.path.replace(/^\/+/, "").includes("/")) continue;
    const fileRank = rank(wikiPageName(file.path));
    if (fileRank < best) {
      best = fileRank;
      first = file;
    }
  }
  return first ? [first, ...files.filter((file) => file !== first)] : files;
}

/**
 * The folder holding a wiki page's subpages: the page path without `.md`
 * (`/Guides.md` → `/Guides`).
 */
export function subpagesFolderOf(documentPath: string): string {
  return documentPath.replace(/\.md$/i, "");
}

/**
 * A page's subpages from a listing of its subpage folder: the folder's
 * Markdown pages in `.order` order, unlisted pages after them by title.
 */
export function subpagesFromListing(listing: FolderListing): WikiSubpage[] {
  const rank = orderRank(listing.order);
  return listing.files
    .map((file) => ({
      path: file.path,
      title: wikiPageTitle(file.path),
      rank: rank(wikiPageName(file.path)),
    }))
    .sort(
      (a, b) =>
        compareRanks(a.rank, b.rank) ||
        a.title.toLowerCase().localeCompare(b.title.toLowerCase()),
    )
    .map(({ path, title }) => ({ path, title }));
}
