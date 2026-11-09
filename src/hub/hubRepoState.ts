// Pure state transitions for the Documents hub's discovery state: folding a
// repo's freshly-resolved details in, flipping its `detailsLoaded` gate, and
// dropping a repo's per-document routing cache entries.

import type { GitPullRequest } from "azure-devops-extension-api/Git";

import type { FileInfo } from "../types";
import type { DocRepo } from "../shell/types";
import type { DiscoveryState } from "./hubDiscovery";

/** A repo's root listing + PR routing, as resolved by `refreshRepoDiscovery`. */
interface RepoDetails {
    files: FileInfo[];
    topLevelFolders: string[];
    rootOrder?: string[];
    recentPr: DocRepo["recentPr"];
    pr: GitPullRequest | null;
}

/** Apply a repo's resolved details (marking it loaded) and its routing PR. */
export function withRepoDetails(
    curr: DiscoveryState | null,
    repoId: string,
    details: RepoDetails,
    canComment: boolean,
): DiscoveryState | null {
    if (!curr) return curr;
    const { files, topLevelFolders, rootOrder, recentPr, pr } = details;

    const nextRepos = curr.repos.map((r) =>
        r.id === repoId
            ? {
                  ...r,
                  files,
                  topLevelFolders,
                  rootOrder,
                  recentPr,
                  detailsLoaded: true,
                  canComment,
              }
            : r,
    );

    const nextPrByRepo = {
        ...curr.prByRepo,
        [repoId]: pr ?? undefined,
    };

    return { ...curr, repos: nextRepos, prByRepo: nextPrByRepo };
}

/** Set a repo's `detailsLoaded` gate, leaving its content untouched. */
export function withRepoDetailsLoaded(
    curr: DiscoveryState | null,
    repoId: string,
    detailsLoaded: boolean,
): DiscoveryState | null {
    if (!curr) return curr;

    const nextRepos = curr.repos.map((r) => (r.id === repoId ? { ...r, detailsLoaded } : r));

    return { ...curr, repos: nextRepos };
}

/** Drop every entry whose key starts with `keyPrefix`; same object if none. */
export function withoutKeyPrefix<T>(prev: Record<string, T>, keyPrefix: string): Record<string, T> {
    let changed = false;
    const next: Record<string, T> = {};

    for (const [key, value] of Object.entries(prev)) {
        if (key.startsWith(keyPrefix)) {
            changed = true;
            continue;
        }

        next[key] = value;
    }

    return changed ? next : prev;
}
