// SDK-coupled context resolution for the PR tab: discovers the active PR and
// project via the SDK, loads its updates and changed `.md` files, and reads
// file content at a commit. Pure pieces live in `prContext.helpers.ts`.

import * as SDK from "azure-devops-extension-sdk";
import {
  GitVersionOptions,
  GitVersionType,
  type GitPullRequest,
  type GitRestClient,
  type GitVersionDescriptor,
} from "azure-devops-extension-api/Git";

import type { ChangeType } from "../types";
import { withRetry } from "../shell/retry";
import { withAdoSessionRefreshDetection } from "../shell/adoAuthToken";
import { readHostToken } from "../shell/adoSessionSdk";
import { resolveCurrentProject, sharedGitClient } from "../shell/adoClients";
import { orgUrlFromReferrer } from "../hub/documentsHub.helpers";
import {
  configuredRepositoryId,
  fetchAllIterationChanges,
  loadWithRepositoryHint,
  pickPullRequestId,
  rangeChangeTypes,
  reviewIterationStops as mapReviewIterationStops,
  retryOnTimeout,
  selectDiffCommits,
  withTimeout,
  type IterationParams,
} from "./prTabApp.helpers";
import {
  changedMarkdownFiles,
  contentCommitForPath,
  type PrContext,
} from "./prContext.helpers";

type BootLog = (step: string, extra?: unknown) => void;

/** A usable REST numeric id: absent (`null`/`undefined`), 0 and NaN are not. */
function hasId(id: number | null | undefined): id is number {
  return id != null && id !== 0 && !Number.isNaN(id);
}

/** What every PR REST call during context resolution is scoped to. */
interface PrRequestScope {
  gitClient: GitRestClient;
  pullRequestId: number;
  projectId: string;
  log: BootLog;
}

export async function resolvePrContext(log: BootLog): Promise<PrContext> {
  const { config, pullRequestId } = readPullRequestId(log);

  const project = await resolveCurrentProject();
  log("got project", project);

  const gitClient = sharedGitClient();
  const projectId = project.id;

  log("fetching pull request by id");
  const prRequest = requestPullRequest(gitClient, pullRequestId, projectId);

  // The host passes the PR's repository with the tab's configuration, so the
  // updates load in parallel with the PR instead of after it.
  const { pr, changes: fileChanges } = await loadWithRepositoryHint(
    prRequest,
    configuredRepositoryId(config, pullRequestId),
    fileChangesLoader({ gitClient, pullRequestId, projectId, log }),
  );

  const repositoryId = pr.repository.id;
  // Typed required, but the ADO REST payload can omit the repository name.
  const repositoryName = (pr.repository.name as string | undefined) ?? "";
  const orgUrl = resolveOrgUrl();
  log("got pull request", { repositoryId, title: pr.title });

  const { iterations, latest, changes } = fileChanges;

  const reviewIterationStops = mapReviewIterationStops(
    iterations,
    pullRequestId,
  );

  const location = {
    projectId,
    projectName: project.name,
    repositoryId,
    repositoryName,
    orgUrl,
    pullRequestId,
    pr,
  };

  if (latest === undefined || !hasId(latest.id) || !changes) {
    log("no iterations; returning empty file list");

    return { ...location, changedMdFiles: [], reviewIterationStops };
  }

  // Return as soon as the Markdown file list is known so the shell can mount
  // and start rendering the first document immediately. Line counts (diffs) and
  // the comment threads are fetched OFF the critical path — diffs by the
  // component, threads by Shell's mount-time thread sync — so first paint
  // never waits on them.
  const changedMdFiles = changedMarkdownFiles(changes);
  // Diff against the iteration's MERGE BASE (three-dot), not the target
  // branch's moving tip, so highlights stay correct after master advances —
  // see `selectDiffCommits`.
  const { baseCommit, targetCommit } = selectDiffCommits(latest, pr);

  return {
    ...location,
    changedMdFiles,
    baseCommit,
    targetCommit,
    reviewIterationStops,
  };
}

/** The PR id from the tab's SDK configuration (or the host referrer). */
function readPullRequestId(log: BootLog): {
  config: Record<string, unknown> | undefined;
  pullRequestId: number;
} {
  log("reading SDK configuration");
  const config = SDK.getConfiguration() as Record<string, unknown> | undefined;
  log("sdk configuration", config);

  const pullRequestId = pickPullRequestId(
    config,
    typeof document !== "undefined" ? document.referrer : "",
  );

  if (!hasId(pullRequestId)) {
    throw new Error(
      `Could not determine pull request id from SDK configuration. ` +
        `Raw configuration: ${JSON.stringify(config, null, 2)}`,
    );
  }

  log("resolved pullRequestId", pullRequestId);

  return { config, pullRequestId };
}

function requestPullRequest(
  gitClient: GitRestClient,
  pullRequestId: number,
  projectId: string,
): Promise<GitPullRequest> {
  // Timeout wraps the WHOLE retry sequence (not each attempt). `withTimeout`
  // can't cancel the underlying SDK request, so a per-attempt timeout would let
  // a timed-out-but-still-in-flight call stack up with its retries. Bounding
  // the entire `withRetry` instead means retries only fire on SETTLED
  // rejections (a real 4xx/5xx — no dangling request), while a genuinely hung
  // call fails after 15s. That hung call is then re-issued once
  // (`retryOnTimeout`): one dangling read is a fair price for not blocking the
  // tab on a stuck connection.
  return retryOnTimeout(() =>
    withTimeout(
      withRetry(
        () =>
          withAdoSessionRefreshDetection(
            () => gitClient.getPullRequestById(pullRequestId, projectId),
            readHostToken,
          ),
        {
          mode: "read",
          label: "getPullRequestById",
        },
      ),
      15_000,
      `getPullRequestById(${pullRequestId}, ${projectId})`,
    ),
  );
}

// The PR's updates, then the latest update's changed files. Iteration
// descriptions already carry the push's title, so commits aren't requested.
function fileChangesLoader(scope: PrRequestScope) {
  const { gitClient, pullRequestId, projectId, log } = scope;

  return async (repositoryId: string) => {
    log("fetching pull request iterations", repositoryId);

    const iterations = await withRetry(
      () =>
        withAdoSessionRefreshDetection(
          () =>
            gitClient.getPullRequestIterations(
              repositoryId,
              pullRequestId,
              projectId,
              false,
            ),
          readHostToken,
        ),
      { mode: "read", label: "getPullRequestIterations" },
    );

    const latest =
      iterations.length > 0 ? iterations[iterations.length - 1] : undefined;

    if (latest === undefined || !hasId(latest.id)) {
      return { iterations, latest, changes: undefined };
    }

    log("fetching iteration changes", latest.id);
    const latestId = latest.id;

    const changes = await fetchAllIterationChanges((top, skip) =>
      withRetry(
        () =>
          withAdoSessionRefreshDetection(
            () =>
              gitClient.getPullRequestIterationChanges(
                repositoryId,
                pullRequestId,
                latestId,
                projectId,
                top,
                skip,
              ),
            readHostToken,
          ),
        { mode: "read", label: "getPullRequestIterationChanges" },
      ),
    );

    return { iterations, latest, changes };
  };
}

/**
 * Which Markdown files a comparison of PR updates touches: ADO's iteration
 * changes for the newer update compared to the older one (0 = the PR base),
 * paged.
 */
export async function fetchRangeChangeTypes(
  ctx: PrContext,
  params: IterationParams,
): Promise<Record<string, ChangeType>> {
  const gitClient = sharedGitClient();

  const entries = await fetchAllIterationChanges((top, skip) =>
    withRetry(
      () =>
        gitClient.getPullRequestIterationChanges(
          ctx.repositoryId,
          ctx.pullRequestId,
          params.iteration,
          ctx.projectId,
          top,
          skip,
          params.base,
        ),
      { mode: "read", label: "getPullRequestIterationChanges.range" },
    ),
  );

  return rangeChangeTypes(entries);
}

/** A Git version descriptor pinning `commitId`, if any. */
export function commitVersionDescriptor(
  commitId: string | undefined,
): GitVersionDescriptor | undefined {
  return commitId != null && commitId !== ""
    ? {
        version: commitId,
        versionType: GitVersionType.Commit,
        versionOptions: GitVersionOptions.None,
      }
    : undefined;
}

export async function fetchFileContent(
  ctx: PrContext,
  path: string,
): Promise<string> {
  return fetchFileContentAtCommit(ctx, path, contentCommitForPath(ctx, path));
}

export async function fetchFileContentAtCommit(
  ctx: PrContext,
  path: string,
  commitId?: string,
): Promise<string> {
  const gitClient = sharedGitClient();
  const versionDescriptor = commitVersionDescriptor(commitId);

  const ab = await withRetry(
    () =>
      gitClient.getItemContent(
        ctx.repositoryId,
        path,
        ctx.projectId,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        versionDescriptor,
        true,
      ),
    { mode: "read", label: "fetchFileContent.getItemContent" },
  );

  return new TextDecoder("utf-8").decode(new Uint8Array(ab));
}

/**
 * Resolve the organization's web URL (no trailing slash) for building deep
 * links to mentioned work items and PRs. Probe `SDK.getHost().name` (the org
 * slug for modern ADO), then fall back to `document.referrer`'s origin + first
 * path segment. Returns `""` when nothing resolves (mentions stay
 * non-navigable rather than crashing).
 */
function resolveOrgUrl(): string {
  try {
    // `getHost()` is typed non-null but is undefined until SDK init completes.
    const host = SDK.getHost() as SDK.IHostContext | undefined;
    const name = host?.name;
    if (name != null && name !== "") return `https://dev.azure.com/${name}`;
  } catch {
    // Falls through to the referrer-based heuristic.
  }

  return orgUrlFromReferrer(
    typeof document !== "undefined" ? document.referrer : "",
  );
}
