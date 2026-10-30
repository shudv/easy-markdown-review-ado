// Pure helpers extracted from DocumentsApp so they can be unit-tested in
// isolation. Nothing here touches React or the Azure DevOps SDK — the
// container owns state/effects and delegates derivations to these functions.

import type { FileInfo, PrInfo } from "../types";
import type { RoutedPrInfo } from "../shell/PrShell";
import type { DocRepo, FolderListing } from "../shell/types";
import type { MentionLinkResolution } from "../comments/mentionLinks";
import { normalizeFolderPath } from "../shell/components/folderTree";
import { withFirstPageFirst } from "../shell/wikiOrder";
import { COMMENT_PERMISSION_DENIED_MESSAGE } from "../shell/commentPermission.helpers";

/**
 * Lazy tree state per active repo. Seeded from `selectedRepo.files` +
 * `topLevelFolders` on repo change; grows as folders are expanded via
 * `onExpandFolder`. Fully-loaded repos (standalone fixtures) leave
 * `unloadedFolders` empty.
 */
export interface LazyTreeState {
  repoId: string;
  files: FileInfo[];
  unloadedFolders: string[];
  /** Wiki `.order` page names per listed folder (slash-free path, root `""`). */
  folderOrders: Record<string, string[]>;
}

/** Seed a repo's lazy tree from its root listing. */
export function seedLazyTree(repo: DocRepo): LazyTreeState {
  return {
    repoId: repo.id,
    files: repo.files,
    unloadedFolders: [...(repo.topLevelFolders ?? [])],
    folderOrders: repo.rootOrder ? { "": repo.rootOrder } : {},
  };
}

/** Merge a just-expanded folder's listing into a repo's lazy-tree entry. */
export function mergeFolderListing(
  entry: LazyTreeState,
  repoId: string,
  path: string,
  payload: FolderListing,
): LazyTreeState {
  const seenFiles = new Set(entry.files.map((f) => f.path));
  const mergedFiles = entry.files.slice();
  for (const f of payload.files) {
    if (!seenFiles.has(f.path)) {
      seenFiles.add(f.path);
      mergedFiles.push(f);
    }
  }
  // Drop the just-expanded folder; add new unloaded subfolders. Folder
  // paths arrive in two flavours across the host boundary (`/docs` vs
  // `docs`), so canonicalize every value to a "no leading slash" form
  // — otherwise the set accumulates both variants.
  const canonicalize = (p: string): string => p.replace(/^\/+/, "");
  const unloaded = new Set(entry.unloadedFolders.map(canonicalize));
  unloaded.delete(canonicalize(path));
  for (const sub of payload.folders) {
    unloaded.add(canonicalize(sub));
  }
  mergedFiles.sort((a, b) => a.path.localeCompare(b.path));
  return {
    repoId,
    files: mergedFiles,
    unloadedFolders: Array.from(unloaded).sort((a, b) => a.localeCompare(b)),
    folderOrders: payload.order
      ? {
          ...entry.folderOrders,
          [normalizeFolderPath(path)]: payload.order,
        }
      : entry.folderOrders,
  };
}

/**
 * Resolve the active repo from the accumulated `repos` union, falling back to
 * the previously-resolved repo (`cached`) when it is momentarily missing from
 * the list, and finally to the first repo.
 */
export function pickSelectedRepo(
  repos: DocRepo[],
  selectedRepoId: string,
  cached: DocRepo | undefined,
): DocRepo | undefined {
  const found = repos.find((r) => r.id === selectedRepoId);
  if (found) return found;
  if (cached?.id === selectedRepoId) return cached;
  return repos[0];
}

/**
 * Build the `PrInfo` PrShell expects (it only renders `files`; the other
 * fields are set for a readable DevTools breadcrumb). `files` comes from
 * the cached `lazyTree.files` so expansion + search visibly grow the tree.
 */
export function buildSyntheticPr(
  repo: DocRepo,
  lazyTree: LazyTreeState | undefined,
): PrInfo {
  const treeFiles = lazyTree ? lazyTree.files : repo.files;
  return {
    prId: repo.recentPr?.id ?? 0,
    title: `Documents in ${repo.name}`,
    authorName: repo.recentPr?.author ?? "\u2014",
    // The default document is the first file: a wiki opens its first page.
    files: withFirstPageFirst(treeFiles, repo.rootOrder),
  };
}

/**
 * Build the routed-PR pill payload for the rail (only when the repo has a
 * completed PR; the rail hides when null).
 */
export function buildRoutedPr(repo: DocRepo | undefined): RoutedPrInfo | null {
  const rp = repo?.recentPr;
  if (!rp) return null;
  return {
    prId: rp.id,
    title: rp.title,
    status: rp.status,
    url: rp.url,
  };
}

/** Commenting gates for the active repo. */
interface CommentGating {
  /** No routing PR to route repo-level comments through. */
  readOnly: boolean;
  /** Effective read-only flag handed to PrShell. */
  shellReadOnly: boolean;
  /** Effective read-only banner message handed to PrShell. */
  shellReadOnlyMessage: string | undefined;
}

export function resolveCommentGating(
  perDocumentMode: boolean,
  repo: DocRepo | undefined,
): CommentGating {
  // Disable commenting when there's no PR to route through. The rail then
  // renders a read-only banner and the article suppresses its selection bubble.
  const readOnly = !repo?.recentPr;
  if (!perDocumentMode) {
    return {
      readOnly,
      shellReadOnly: readOnly,
      shellReadOnlyMessage:
        readOnly && repo
          ? `${repo.name} has no completed pull request — commenting is disabled until one is completed.`
          : undefined,
    };
  }
  // Per-document mode has no routing PR to gate on; instead commenting is
  // disabled only when ADO explicitly denied Contribute on the repo. The rail
  // surfaces the reason in its read-only banner (right panel).
  const denied = repo?.canComment === false;
  return {
    readOnly,
    shellReadOnly: denied,
    shellReadOnlyMessage: denied
      ? COMMENT_PERMISSION_DENIED_MESSAGE
      : undefined,
  };
}

/**
 * Mention-link hydration context. `defaultRepoName` tracks the selected repo
 * so PR mentions that omit the `repo` URL param still resolve. Null when
 * org/project aren't supplied (standalone) — the hydrator no-ops on null.
 */
export function buildMentionLinks(
  orgUrl: string | undefined,
  projectName: string | undefined,
  defaultRepoName: string | undefined,
): MentionLinkResolution | null {
  return orgUrl && projectName
    ? { orgUrl, projectName, defaultRepoName }
    : null;
}

interface ShellTreeState {
  unloadedFolders: string[];
  /**
   * A repo whose content has loaded but holds no markdown at all (no root
   * files and no subfolders to expand). Drives the friendly "No documents"
   * empty state instead of mounting PrShell on an empty file list.
   */
  isEmptyRepo: boolean;
  /**
   * True on renders where PrShell is actually shown (the repo's routing has
   * resolved and the repo isn't empty).
   */
  prShellMounting: boolean;
}

export function resolveShellTree(
  repo: DocRepo,
  lazyTree: LazyTreeState | undefined,
  fileCount: number,
): ShellTreeState {
  const unloadedFolders = lazyTree
    ? lazyTree.unloadedFolders
    : (repo.topLevelFolders ?? []);
  const loaded = repo.detailsLoaded !== false;
  const isEmptyRepo = loaded && fileCount === 0 && unloadedFolders.length === 0;
  return {
    unloadedFolders,
    isEmptyRepo,
    prShellMounting: loaded && !isEmptyRepo,
  };
}

/** Deep-link seeds forwarded to PrShell on the initial repo's first mount. */
export interface DeepLinkSeeds {
  initialSelectedPath?: string;
  initialActiveThreadId?: string;
  initialAnchor?: string;
  initialTextFragment?: string;
}

/** Forward the deep-link seeds only while they are still `active`. */
export function pickDeepLinkSeeds(
  active: boolean,
  seeds: DeepLinkSeeds,
): DeepLinkSeeds {
  if (!active) return {};
  return {
    initialSelectedPath: seeds.initialSelectedPath,
    initialActiveThreadId: seeds.initialActiveThreadId,
    initialAnchor: seeds.initialAnchor,
    initialTextFragment: seeds.initialTextFragment,
  };
}

/**
 * Index of the repo-picker option to focus for a menu navigation key, or
 * `undefined` when the key isn't a navigation key. `current` is the focused
 * option's index (`-1` when focus is elsewhere, e.g. the filter box).
 */
export function menuFocusTarget(
  key: string,
  current: number,
  count: number,
): number | undefined {
  if (key === "ArrowDown" || key === "ArrowUp") {
    const dir = key === "ArrowDown" ? 1 : -1;
    // Coming from the filter box (or nothing focused): enter the list.
    if (current === -1) return dir === 1 ? 0 : count - 1;
    return (current + dir + count) % count;
  }
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return undefined;
}
