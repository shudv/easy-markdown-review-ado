// Deep-link query contract for the Documents hub page. A hub URL may carry a
// target file in its query string (e.g. an externally shared / bookmarked deep
// link); the hub reads it back with `parseHubQuery`. Kept SDK-free (no
// `azure-devops-extension-sdk` / `-api` imports) so it can be unit-tested under
// node/vitest.

/** Target file parsed from the hub query params. */
export interface HubTarget {
  repositoryId: string;
  repositoryName?: string;
  project: string;
  path: string;
  version?: string;
}

/**
 * Query-param keys carrying a target file in a Documents hub deep link. The
 * reader (`parseHubQuery`) is the only consumer; the keys are defined once here
 * so the hub can never drift from the contract — a drift would silently land the
 * hub on its empty state.
 */
export const HUB_QUERY_KEYS = {
  repositoryId: "emrRepo",
  repositoryName: "emrRepoName",
  project: "emrProj",
  path: "emrPath",
  version: "emrVer",
} as const;

/**
 * Pull a target out of the hub page's query params. Returns `null` when the
 * required keys are absent (the direct-navigation / empty-state case). Pure +
 * SDK-free for unit testing.
 */
export function parseHubQuery(
  params: Record<string, string>,
): HubTarget | null {
  const repositoryId = params[HUB_QUERY_KEYS.repositoryId];
  const project = params[HUB_QUERY_KEYS.project];
  const path = params[HUB_QUERY_KEYS.path];
  if (!repositoryId || !project || !path) return null;
  return {
    repositoryId,
    repositoryName: params[HUB_QUERY_KEYS.repositoryName] || undefined,
    project,
    path,
    version: params[HUB_QUERY_KEYS.version] || undefined,
  };
}
