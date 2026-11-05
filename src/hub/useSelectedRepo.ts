// Documents hub: the selected repository and its telemetry context.

import * as React from "react";

import type { DocRepo } from "../shell/types";
import { events, setTelemetryContext, track } from "../telemetry";
import { pickSelectedRepo } from "./documentsApp.helpers";
import type { DocumentsAppProps } from "./documentsAppProps";

/**
 * Active-repo selection. A third-party hub is never handed the repo the user
 * had selected in Repos, so the hub lists every repo in the project and the
 * user switches between them with the in-rail picker. `initialRepoId` seeds
 * the choice (deep link > last-visited > first repo on page one).
 */
export function useSelectedRepo(
  repos: DocRepo[],
  initialRepoId: string,
  onSelectRepo: DocumentsAppProps["onSelectRepo"],
  onLoadRepoDetails: DocumentsAppProps["onLoadRepoDetails"],
) {
  const [selectedRepoId, setSelectedRepoId] =
    React.useState<string>(initialRepoId);

  // Resolve the active repo from the accumulated `repos` union. The last
  // resolution is kept in state so that when the picker's *view* is narrowed by
  // a server-side filter — which can momentarily drop the selected repo out of
  // the visible list — the open document doesn't snap to `repos[0]`. The
  // selected repo only changes when the user actually picks a new one.
  // Re-resolved during render whenever `repos` or the selected id changes.
  const [resolution, setResolution] = React.useState(() => ({
    repos,
    repoId: selectedRepoId,
    repo: pickSelectedRepo(repos, selectedRepoId, undefined),
  }));
  let selectedRepo = resolution.repo;
  if (resolution.repos !== repos || resolution.repoId !== selectedRepoId) {
    selectedRepo = pickSelectedRepo(repos, selectedRepoId, resolution.repo);
    setResolution({ repos, repoId: selectedRepoId, repo: selectedRepo });
  }

  const handleSelectRepo = React.useCallback(
    (repoId: string) => {
      setSelectedRepoId(repoId);
      onSelectRepo?.(repoId);
      track(events.repoSwitched());
    },
    [onSelectRepo],
  );

  // Keep telemetry's de-identified repo context in sync with the active repo
  // (covers both the initial selection and later switches). Repo *id* only.
  React.useEffect(() => {
    if (selectedRepoId) setTelemetryContext({ repositoryId: selectedRepoId });
  }, [selectedRepoId]);

  // Trigger the host's deferred per-repo PR-routing load on selection. The
  // host dedupes, so firing on every selectedRepo change is safe.
  React.useEffect(() => {
    if (!selectedRepo || !onLoadRepoDetails) return;
    if (selectedRepo.detailsLoaded === false) {
      void onLoadRepoDetails(selectedRepo.id);
    }
  }, [selectedRepo, onLoadRepoDetails]);

  return { selectedRepoId, selectedRepo, handleSelectRepo };
}
