// Root auto-expansion planner for the Documents hub.
//
// When a repo's content lives entirely under folders (e.g. everything in
// `/docs`), the root listing has no markdown of its own, so the nav would read
// as empty ("Nothing present") until the user manually drilled in. To match
// the expectation that selecting a repo reveals its docs, DocumentsApp walks
// the unloaded top-level folders open one level at a time until the first
// document surfaces. This module holds the pure decision logic so it can be
// unit-tested without React.

/** Canonical, slash-free folder form, matching `handleExpandFolder`. */
function canonicalFolder(path: string): string {
  return path.replace(/^\/+/, "");
}

/** Stable dedupe key for a (repo, folder) pair. */
export function autoExpandKey(repoId: string, folder: string): string {
  return `${repoId}\u0000${canonicalFolder(folder)}`;
}

export interface RootAutoExpandPlan {
  /** Folders to request expansion for now (original, unmodified paths). */
  folders: string[];
  /** Dedupe keys to record as expanded (parallel to `folders`). */
  keys: string[];
  /** Budget consumed for this repo after applying the plan. */
  used: number;
}

/**
 * Decide which top-level folders to auto-expand so a folder-only repo's docs
 * surface without a manual click. Returns no folders once any file is already
 * visible (the root has its own markdown) or the per-repo budget is exhausted,
 * and skips folders already expanded so the same listing is never re-fetched.
 */
export function planRootAutoExpand(opts: {
  repoId: string;
  fileCount: number;
  unloadedFolders: readonly string[];
  expandedKeys: ReadonlySet<string>;
  used: number;
  max: number;
}): RootAutoExpandPlan {
  const { repoId, fileCount, unloadedFolders, expandedKeys, used, max } = opts;
  // A document is already visible — nothing to reveal.
  if (fileCount > 0) return { folders: [], keys: [], used };
  let remaining = max - used;
  if (remaining <= 0) return { folders: [], keys: [], used };
  const folders: string[] = [];
  const keys: string[] = [];
  for (const folder of unloadedFolders) {
    if (remaining <= 0) break;
    const key = autoExpandKey(repoId, folder);
    if (expandedKeys.has(key)) continue;
    folders.push(folder);
    keys.push(key);
    remaining -= 1;
  }
  return { folders, keys, used: max - remaining };
}
