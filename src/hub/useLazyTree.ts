// Documents hub: the lazily loaded file tree per repository.

import { useCallback, useEffect, useRef, useState } from "react";

import type { FileInfo } from "../types";
import type { DocRepo, FolderListing } from "../shell/types";
import { trackUserFacingError } from "../telemetry";
import { planRootAutoExpand } from "./autoExpand";
import { mergeFolderListing, seedLazyTree, type LazyTreeState } from "./documentsApp.helpers";
import type { DocumentsAppProps } from "./documentsAppProps";

/**
 * Lazy-tree working set keyed by repo id. Each entry starts as
 * `{ files: repo.files, unloadedFolders: repo.topLevelFolders }` and grows
 * as `onExpandFolder` resolves. The map is NOT reset on repo switch —
 * entries persist for the DocumentsApp lifetime so re-opening a repo doesn't
 * re-fetch already-expanded folders.
 */
export function useLazyTree(
    selectedRepo: DocRepo | undefined,
    onExpandFolder: DocumentsAppProps["onExpandFolder"],
) {
    const [lazyTreeByRepo, setLazyTreeByRepo] = useState<Map<string, LazyTreeState>>(() => {
        const m = new Map<string, LazyTreeState>();

        // Only seed once the repo's listing has loaded. The paginated picker hands
        // us a content-less skeleton (`detailsLoaded === false`) first; seeding
        // from it would cache an empty tree that never refreshes when the real
        // root listing arrives, leaving the nav permanently empty.
        if (selectedRepo && selectedRepo.detailsLoaded !== false) {
            m.set(selectedRepo.id, seedLazyTree(selectedRepo));
        }

        return m;
    });

    // Seed an entry the first time we see a repo with loaded content; existing
    // entries are the cache. Skeletons (`detailsLoaded === false`) are skipped so
    // the entry is first created from the real listing, not the empty skeleton.
    // Adjusted during render whenever the `selectedRepo` object changes (not on
    // every render: a refresh deletes the entry and must re-seed from the
    // refreshed repo object, not the stale one).
    const [seededFor, setSeededFor] = useState(selectedRepo);

    if (seededFor !== selectedRepo) {
        setSeededFor(selectedRepo);

        if (
            selectedRepo &&
            selectedRepo.detailsLoaded !== false &&
            !lazyTreeByRepo.has(selectedRepo.id)
        ) {
            const next = new Map(lazyTreeByRepo);
            next.set(selectedRepo.id, seedLazyTree(selectedRepo));
            setLazyTreeByRepo(next);
        }
    }

    // The cached entry for the active repo (falls back to `selectedRepo.files`
    // at read sites while a repo has no entry yet, e.g. a skeleton or mid-refresh).
    const lazyTree = selectedRepo ? lazyTreeByRepo.get(selectedRepo.id) : undefined;

    // Lazy folder expansion handler: returns the raw payload to the DocNav and
    // merges the result into the per-repo `lazyTreeByRepo` entry.
    const handleExpandFolder = useCallback(
        async (path: string): Promise<{ files: FileInfo[]; folders: string[] } | null> => {
            if (!selectedRepo || !onExpandFolder) return null;
            const repoIdAtCall = selectedRepo.id;
            let payload: FolderListing;

            try {
                payload = await onExpandFolder(repoIdAtCall, path);
            } catch (err) {
                // Stryker disable next-line StringLiteral: developer-console text only; the failure reaches telemetry via trackUserFacingError below
                console.warn("[documents-hub] expand folder failed:", path, err);
                trackUserFacingError({
                    error: err,
                    source: "DocumentsApp.navigation",
                    operation: "folder-expand",
                    impact: "action-failed",
                });

                return null;
            }

            setLazyTreeByRepo((curr) => {
                const entry = curr.get(repoIdAtCall);
                if (!entry) return curr;
                const next = new Map(curr);
                next.set(repoIdAtCall, mergeFolderListing(entry, repoIdAtCall, path, payload));

                return next;
            });

            return payload;
        },
        [selectedRepo, onExpandFolder],
    );

    useRootAutoExpand(selectedRepo, lazyTree, onExpandFolder, handleExpandFolder);

    return { lazyTree, setLazyTreeByRepo, handleExpandFolder };
}

// After a repo's listing loads, auto-expand its folders so the markdown
// surfaces immediately — a docs repo usually keeps its content under a
// folder (e.g. `/docs`), so the root listing alone has no files and the nav
// would otherwise read as empty until the user manually drilled in. Walks
// one level per pass (the effect re-runs as the tree grows) until the first
// document appears, then stops. Deduped + budgeted via refs so it never
// re-fetches a folder or walks a large repo without bound.
function useRootAutoExpand(
    selectedRepo: DocRepo | undefined,
    lazyTree: LazyTreeState | undefined,
    onExpandFolder: DocumentsAppProps["onExpandFolder"],
    handleExpandFolder: (path: string) => Promise<unknown>,
): void {
    const autoExpandedFoldersRef = useRef<Set<string>>(new Set());
    const autoExpandUsedRef = useRef<Map<string, number>>(new Map());
    useEffect(() => {
        if (!selectedRepo || !onExpandFolder) return;
        // Stryker disable next-line ConditionalExpression: dead code: a skeleton repo never has a seeded tree, so the tree check below returns anyway; candidate for removal
        if (selectedRepo.detailsLoaded === false) return;
        const tree = lazyTree;
        // Stryker disable next-line ConditionalExpression: dead code: with no unloaded folders the plan has nothing to expand and returns below anyway; candidate for removal
        if (!tree || tree.unloadedFolders.length === 0) return;
        const repoId = selectedRepo.id;

        const plan = planRootAutoExpand({
            repoId,
            fileCount: tree.files.length,
            unloadedFolders: tree.unloadedFolders,
            expandedKeys: autoExpandedFoldersRef.current,
            used: autoExpandUsedRef.current.get(repoId) ?? 0,
            max: 40, // safety cap per repo
        });

        // Stryker disable next-line ConditionalExpression: dead code: an empty plan expands nothing and records the same budget, so skipping it changes nothing; candidate for removal
        if (plan.folders.length === 0) return;
        for (const key of plan.keys) autoExpandedFoldersRef.current.add(key);
        autoExpandUsedRef.current.set(repoId, plan.used);
        for (const folder of plan.folders) void handleExpandFolder(folder);
    }, [selectedRepo, lazyTree, onExpandFolder, handleExpandFolder]);
}
