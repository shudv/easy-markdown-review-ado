// PrShell: the shown article (live or historical) and its load state.

import * as React from "react";

import type { DiffRange, FileInfo } from "../../types";
import type { DocumentImageResolver } from "../../markdown/documentImages";
import {
  bindRepositoryImageResolver,
  type HistoryStop,
} from "../prShellHelpers";
import type { FolderLister } from "../wikiOrder";
import { useWikiSubpages } from "../useWikiSubpages";
import { activeArticleState, historicalStatus } from "./derive";

interface ActiveArticleOptions {
  selectedPath: string;
  files: FileInfo[];
  htmlByPath: Record<string, string>;
  diffsByFile: Record<string, DiffRange[]>;
  originalSourcesByFile: Record<string, string> | undefined;
  viewingHistorical: boolean;
  comparingIterations: boolean;
  activeStop: HistoryStop;
  toUpdate: number;
  historicalContentKey: string | null;
  baselineContentKey: string | null;
  historicalLoadTargets: readonly { key: string }[];
  historicalHtmlByKey: Record<string, string>;
  historicalSourceByKey: Record<string, string>;
  historicalErrorByKey: Record<string, string>;
  historicalAbsentByKey: Record<string, true>;
  listFolder: FolderLister | undefined;
  resolveDocumentImage: DocumentImageResolver | undefined;
  activeStorageKeyRef: React.MutableRefObject<string>;
}

/**
 * The article actually shown — the live document or, while the stepper is on
 * an earlier stop, its historical snapshot — with its load state.
 */
export function useActiveArticle(opts: ActiveArticleOptions) {
  const { selectedPath, files, viewingHistorical, activeStop } = opts;
  const pristineHtml = opts.htmlByPath[selectedPath] ?? "";
  const currentFileDiff = opts.diffsByFile[selectedPath];
  const currentOriginalSource = opts.originalSourcesByFile?.[selectedPath];
  // A file added or removed wholesale in the PR has no meaningful "what
  // changed" story — every line is the same colour — so we suppress the diff
  // layer and its toggle for those and just show the clean document.
  const currentFileChangeType = React.useMemo(
    () => files.find((f) => f.path === selectedPath)?.changeType,
    [files, selectedPath],
  );
  const isWholeFileChange =
    currentFileChangeType === "added" || currentFileChangeType === "deleted";
  // ---- comment-history stepper: active-stop render values ----
  // A historical stop swaps the whole document view atomically — content,
  // threads, routed-PR pill and read-only state all follow the active stop, so
  // the existing anchor/positioning pipeline simply re-resolves against the
  // historical snapshot.
  const status = historicalStatus({ ...opts, currentFileChangeType });
  const { activePristineHtml, activeStorageKey, articleReady } =
    activeArticleState({ ...opts, status, pristineHtml });

  const articleHtml = useWikiSubpages({
    html: activePristineHtml,
    documentPath: selectedPath,
    historical: status.usingHistoricalContent,
    commitId: activeStop.commitId,
    listFolder: opts.listFolder,
  });
  opts.activeStorageKeyRef.current = activeStorageKey;

  const resolveDocumentImage = opts.resolveDocumentImage;
  const activeDocumentImageResolver = React.useMemo(
    () =>
      bindRepositoryImageResolver(
        resolveDocumentImage,
        selectedPath,
        viewingHistorical ? activeStop.commitId : undefined,
      ),
    [
      resolveDocumentImage,
      selectedPath,
      viewingHistorical,
      activeStop.commitId,
    ],
  );

  return {
    ...status,
    pristineHtml,
    currentFileDiff,
    currentOriginalSource,
    currentFileChangeType,
    isWholeFileChange,
    activePristineHtml,
    articleHtml,
    activeStorageKey,
    articleReady,
    activeDocumentImageResolver,
  };
}
