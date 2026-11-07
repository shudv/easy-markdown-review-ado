// Documents hub: per-repository bindings handed to Shell (comments, links, history).

import { useCallback, useMemo } from "react";

import type { CommentThread } from "../types";
import type { RoutedPrInfo } from "../shell/Shell";
import type { DocPrRef } from "../shell/shellHelpers";
import type { CommentApi } from "../comments/api";
import type { DocRepo } from "../shell/types";
import type { FolderLister } from "../shell/wikiOrder";
import type { DocumentsAppProps } from "./documentsAppProps";

/**
 * Repo-scoped loaders/APIs: curry the active repo id onto the host's
 * `(repoId, …)` callbacks so Shell's per-path contracts are satisfied
 * without leaking the repo id.
 */
export function useRepoBindings(
    props: DocumentsAppProps,
    selectedRepo: DocRepo | undefined,
    perDocumentMode: boolean,
) {
    const repoBindings = useRepoScopedBindings(props, selectedRepo);

    const perDocumentBindings = usePerDocumentBindings(props, selectedRepo, perDocumentMode);

    // Folder lister for `[[_TOSP_]]` subpage tables, bound to the active repo.
    const listSubpageFolderBound = useMemo<FolderLister | undefined>(() => {
        const fn = props.onListSubpageFolder;
        if (!fn || !selectedRepo) return undefined;
        const repoId = selectedRepo.id;

        return (folderPath, atCommitId) => fn(repoId, folderPath, atCommitId);
    }, [props.onListSubpageFolder, selectedRepo]);

    return {
        ...repoBindings,
        ...perDocumentBindings,
        listSubpageFolderBound,
    };
}

/** Source loader, image resolver and repo-level comment API for the active repo. */
function useRepoScopedBindings(props: DocumentsAppProps, selectedRepo: DocRepo | undefined) {
    const { loadFileSource, commentApiFor } = props;

    // Curry the per-repo source loader so Shell's `loadFileSource(path)`
    // contract is satisfied without leaking the repo id.
    const repoScopedLoader = useCallback(
        (path: string): Promise<string> => {
            if (!selectedRepo) {
                return Promise.reject(new Error("No repo selected"));
            }

            return loadFileSource(selectedRepo.id, path);
        },
        [selectedRepo, loadFileSource],
    );

    const resolveDocumentImageBound = useMemo<
        | ((
              documentPath: string,
              repositoryPath: string,
              atCommitId?: string,
          ) => Promise<string | undefined>)
        | undefined
    >(() => {
        const resolveImage = props.resolveDocumentImage;
        if (!selectedRepo || !resolveImage) return undefined;
        const repoId = selectedRepo.id;

        return (
            documentPath: string,
            repositoryPath: string,
            atCommitId?: string,
        ): Promise<string | undefined> =>
            resolveImage(repoId, documentPath, repositoryPath, atCommitId);
    }, [props.resolveDocumentImage, selectedRepo]);

    const commentApi = useMemo<CommentApi | undefined>(() => {
        if (!selectedRepo || !commentApiFor) return undefined;

        return commentApiFor(selectedRepo.id);
    }, [selectedRepo, commentApiFor]);

    return { repoScopedLoader, resolveDocumentImageBound, commentApi };
}

/** Per-document routing + comment-history loaders, bound to the active repo. */
function usePerDocumentBindings(
    props: DocumentsAppProps,
    selectedRepo: DocRepo | undefined,
    perDocumentMode: boolean,
) {
    // Per-document mode: curry the repo id so Shell's per-path contracts
    // (`(path) => …`) are satisfied without leaking it.
    const commentApiForPathBound = useMemo<
        ((path: string) => CommentApi | undefined) | undefined
    >(() => {
        const fn = props.commentApiForPath;
        if (!perDocumentMode || !fn || !selectedRepo) return undefined;
        const repoId = selectedRepo.id;

        return (path: string) => fn(repoId, path);
    }, [perDocumentMode, props.commentApiForPath, selectedRepo]);

    const loadThreadsForPathBound = useMemo<
        ((path: string) => Promise<CommentThread[]>) | undefined
    >(() => {
        const fn = props.loadThreadsForPath;
        if (!perDocumentMode || !fn || !selectedRepo) return undefined;
        const repoId = selectedRepo.id;

        return (path: string) => fn(repoId, path);
    }, [perDocumentMode, props.loadThreadsForPath, selectedRepo]);

    // Per-document mode: curry the repo id so Shell resolves the routed-PR
    // pill for its selected file.
    const routedPrForPathBound = useMemo<
        ((path: string) => RoutedPrInfo | null | undefined) | undefined
    >(() => {
        const fn = props.routedPrForPath;
        if (!perDocumentMode || !fn || !selectedRepo) return undefined;
        const repoId = selectedRepo.id;

        return (path: string) => fn(repoId, path);
    }, [perDocumentMode, props.routedPrForPath, selectedRepo]);

    // Comment-history stepper: curry the repo id onto the three history loaders
    // so Shell's per-path stepper contracts are satisfied.
    const loadDocHistoryBound = useMemo<((path: string) => Promise<DocPrRef[]>) | undefined>(() => {
        const fn = props.loadDocHistory;
        if (!perDocumentMode || !fn || !selectedRepo) return undefined;
        const repoId = selectedRepo.id;

        return (path: string) => fn(repoId, path);
    }, [perDocumentMode, props.loadDocHistory, selectedRepo]);

    const loadThreadsForPrBound = useMemo<
        ((prId: number, path: string) => Promise<CommentThread[]>) | undefined
    >(() => {
        const fn = props.loadThreadsForPr;
        if (!perDocumentMode || !fn || !selectedRepo) return undefined;
        const repoId = selectedRepo.id;

        return (prId: number, path: string) => fn(repoId, prId, path);
    }, [perDocumentMode, props.loadThreadsForPr, selectedRepo]);

    const loadFileSourceAtBound = useMemo<
        ((path: string, commitId: string) => Promise<string>) | undefined
    >(() => {
        const fn = props.loadFileSourceAt;
        if (!perDocumentMode || !fn || !selectedRepo) return undefined;
        const repoId = selectedRepo.id;

        return (path: string, commitId: string) => fn(repoId, path, commitId);
    }, [perDocumentMode, props.loadFileSourceAt, selectedRepo]);

    return {
        commentApiForPathBound,
        loadThreadsForPathBound,
        routedPrForPathBound,
        loadDocHistoryBound,
        loadThreadsForPrBound,
        loadFileSourceAtBound,
    };
}
