// Top-level component for the Markdown Review PR tab in real ADO. Discovers
// the active PR/project via the SDK, lists the changed `.md` files, loads
// emr-authored threads, and feeds a PrInfo +
// loadFileSource closure + thread CommentApi into the shared <PrShell/>.

import * as React from "react";
import * as SDK from "azure-devops-extension-sdk";
import {
  CommonServiceIds,
  type IHostNavigationService,
} from "azure-devops-extension-api";
import {
  GitVersionOptions,
  GitVersionType,
  PullRequestStatus,
  type GitPullRequest,
} from "azure-devops-extension-api/Git";

import {
  PrShell,
  type RoutedPrInfo,
  type DocLinkNavigation,
} from "../shell/PrShell";
import type {
  HistoryStop,
  ReviewIterationRange,
} from "../shell/prShellHelpers";
import { ReaderLoadingShell } from "../shell/components/ReaderLoadingShell";
import { AvatarImageContext } from "../shell/components/Avatar";
import {
  listSubpageFolder,
  resolveAdoAvatarObjectUrl,
} from "../shell/adoGitData";
import type { FolderLister } from "../shell/wikiOrder";
import { resolveAdoRepositoryImageObjectUrl } from "../shell/adoRepositoryImages";
import { identityAvatarUrl } from "../shell/adoGitData.helpers";
import { buildReposFileUrl } from "../markdown/docLinks";
import { buildHubDocUrl } from "../hub/documentsHub.helpers";
import type {
  ChangeType,
  CommentAuthor,
  CommentThread,
  DiffRange,
  FileInfo,
  PrInfo,
} from "../types";
import {
  AdoCommentApi,
  fetchFileDiffs,
  loadAdoThreads,
  type FileDiffInfo,
} from "../shell/adoCommentApi";
import {
  MentionLinkContext,
  type MentionLinkResolution,
} from "../comments/mentionLinks";
import {
  ANCHOR_LINK_PARAM,
  COMMENT_LINK_PARAM,
  TEXT_LINK_PARAM,
  DeepLinkContext,
  PATH_LINK_PARAM,
  withDeepLinkTarget,
  type DeepLinkBuilder,
} from "../shell/deepLink";
import {
  markAppReady,
  markBootAuthWaitEnd,
  markBootAuthWaitStart,
  markBootPhase,
  setTelemetryContext,
  trackUserFacingError,
} from "../telemetry";
import { withRetry } from "../shell/retry";
import {
  detectSessionRefreshing,
  planSessionRefreshRetry,
  type AdoGrantState,
  withAdoSessionRefreshDetection,
} from "../shell/adoAuthToken";
import {
  AUTO_RELOAD_STALL_MS,
  BOOT_AUTO_RELOAD_AFTER_MS,
  adoSession,
  autoReloadAllowed,
  claimAutoReload,
  sessionStorageOrUndefined,
} from "../shell/adoSession";
import { readHostToken } from "../shell/adoSessionSdk";
import {
  BASE_LINK_PARAM,
  ITERATION_LINK_PARAM,
  buildPrTabDocUrl,
  buildPrWebUrl,
  iterationParamsForRange,
  rangeChangeTypes,
  contentCommitForChange,
  diffableFilePaths,
  fetchAllIterationChanges,
  mapChangeType,
  markdownChangePath,
  pickPullRequestId,
  configuredRepositoryId,
  loadWithRepositoryHint,
  prTabRoutePath,
  resolvePrTabRouteSeed,
  reviewIterationStops as mapReviewIterationStops,
  selectDiffCommits,
  withTimeout,
  type IterationParams,
  type PrTabRouteSeed,
} from "./prTabApp.helpers";
import { resolveCurrentProject, sharedGitClient } from "../shell/adoClients";

interface PrContext {
  projectId: string;
  projectName: string;
  repositoryId: string;
  repositoryName: string;
  /** Org root URL, e.g. `https://dev.azure.com/<org>`. No trailing slash. */
  orgUrl: string;
  pullRequestId: number;
  pr: GitPullRequest;
  /** Changed `.md` files; Markdown rendering never waits on diff data. */
  changedMdFiles: FileInfo[];
  /** Commits to diff between for inline change highlights. */
  baseCommit?: string;
  targetCommit?: string;
  /** Native source-branch pushes for the status-bar iteration picker. */
  reviewIterationStops: HistoryStop[];
}

// Stable empty array: threads load after mount via PrShell's thread sync, so
// the shell seeds its reducer with this instead of blocking first paint on the
// thread fetch. Module-scoped so its identity never changes across renders.
const EMPTY_INITIAL_THREADS: CommentThread[] = [];

export function PrTabApp(): React.ReactElement {
  const [ctx, setCtx] = React.useState<PrContext | null>(null);
  const [user, setUser] = React.useState<CommentAuthor | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // Bumped by the boot error's "Try again" to re-run context resolution. A
  // transient auth blip (a 401 on the first git call, most common on the legacy
  // {org}.visualstudio.com host) clears on a fresh attempt with a warm token.
  const [bootAttempt, setBootAttempt] = React.useState(0);
  // Set when a boot failure is the token dead-window (see adoAuthToken.ts): the
  // host is serving an ADO-expired token, so only a re-mint (auto at the AAD
  // `exp`, or a host reload) can heal it. Kept distinct from `error` so the UI
  // shows an accurate "refreshing" state instead of a raw TF400813.
  const [refreshing, setRefreshing] = React.useState<{
    state: AdoGrantState;
    recoverAtMs?: number;
    /** An automatic host reload is allowed (see `claimAutoReload`). */
    autoReload: boolean;
  } | null>(null);
  // How many auto-retries we've scheduled for the current refreshing spell, so
  // `planSessionRefreshRetry` can bound them before falling back to manual.
  const [refreshAttempt, setRefreshAttempt] = React.useState(0);
  // Deep-link targets from the route (`?path=`, `?comment=`, `?anchor=`), read
  // once at startup. `null` until read, so the shell mounts on the right file.
  const [routeSeed, setRouteSeed] = React.useState<PrTabRouteSeed | null>(null);
  // The document on screen — encoded into shared links so they open the same
  // file. Seeded from the route (or the first changed file) once known.
  const [activeDocPath, setActiveDocPath] = React.useState("");
  // The compared PR updates as ADO iteration ids, for shared links and the
  // address bar. `undefined` = "All updates" (left out of links).
  const [activeIterationParams, setActiveIterationParams] = React.useState<
    IterationParams | undefined
  >(undefined);
  // Per-file diff data, fetched OFF the critical path (see the effect below).
  // Starts empty so the shell renders Markdown immediately; diff decorations
  // fill in when this resolves.
  const [diffsByFile, setDiffsByFile] = React.useState<
    Record<string, DiffRange[]>
  >({});
  const [originalSourcesByFile, setOriginalSourcesByFile] = React.useState<
    Record<string, string>
  >({});
  React.useEffect(() => {
    void (async () => {
      setError(null);
      setRefreshing(null);
      const log = (step: string, extra?: unknown) => {
        // eslint-disable-next-line no-console
        console.log(`[PrTabApp] ${step}`, extra ?? "");
      };
      try {
        log("resolving pr context");
        const bootStartedAt = Date.now();
        const context = await resolvePrContext(log);
        adoSession.noteSuccess(bootStartedAt);
        markBootPhase("context-ready");
        log("pr context resolved", {
          projectId: context.projectId,
          repositoryId: context.repositoryId,
          pullRequestId: context.pullRequestId,
          fileCount: context.changedMdFiles.length,
        });
        // De-identified context for all subsequent telemetry. IDs only — the
        // PR id is hashed inside setTelemetryContext.
        setTelemetryContext({
          projectId: context.projectId,
          repositoryId: context.repositoryId,
          pullRequestId: context.pullRequestId,
        });
        setCtx(context);
        log("reading current user");
        const u = SDK.getUser();
        setUser({
          id: u.id,
          displayName: u.displayName,
          initials: initialsOf(u.displayName),
          avatarUrl: identityAvatarUrl(u),
        });
        const seed = await readRouteSeed(
          context.changedMdFiles,
          context.reviewIterationStops,
        );
        setActiveDocPath(
          seed.selectedPath ?? context.changedMdFiles[0]?.path ?? "",
        );
        setRouteSeed(seed);
        setRefreshAttempt(0);
        log("ready");
      } catch (err: unknown) {
        const refresh = await detectSessionRefreshing(err, readHostToken);
        if (refresh) {
          console.warn("[PrTabApp] ADO session refreshing", refresh.grantState);
          trackUserFacingError({
            error: refresh,
            source: "PrTabApp.context",
            operation: "session-refresh",
            impact: "degraded",
          });
          adoSession.report(refresh, "boot");
          markBootAuthWaitStart();
          setRefreshing({
            state: refresh.grantState,
            recoverAtMs: refresh.recoverAtMs,
            autoReload: autoReloadAllowed(
              sessionStorageOrUndefined(),
              Date.now(),
            ),
          });
          return;
        }
        console.error("[PrTabApp] load failed", err);
        trackUserFacingError({
          error: err,
          source: "PrTabApp.context",
          operation: "pr-context-load",
          impact: "blocking",
        });
        setError(formatError(err));
      }
    })();
  }, [bootAttempt]);

  // Auto-recover from the token dead-window, whichever comes first:
  //   - the shared session monitor sees the host hand out a fresh token (it
  //     re-reads the token every few seconds — usually minutes before the AAD
  //     `exp`), and boot re-runs at once;
  //   - after a short grace, one automatic HOST reload (guarded against loops),
  //     which escapes the dead window about 3 times in 4 in production;
  //   - the AAD-`exp` timer from `planSessionRefreshRetry`, as a backstop.
  // Bounded; once exhausted the user falls back to the manual "Reload page".
  React.useEffect(() => {
    if (!refreshing) return;
    const retryBoot = (): void => {
      markBootAuthWaitEnd();
      setRefreshAttempt((n) => n + 1);
      setRefreshing(null);
      setError(null);
      setBootAttempt((n) => n + 1);
    };
    const offRecovered = adoSession.onRecovered(retryBoot);
    // If the automatic reload can't happen (the loop guard can't be recorded,
    // or the host refuses), or it was requested but the page is still here a
    // while later, swap "This only takes a moment" for the manual action.
    const offerManualReload = (): void =>
      setRefreshing((r) => (r?.autoReload ? { ...r, autoReload: false } : r));
    let manualId: number | undefined;
    const reloadId = refreshing.autoReload
      ? window.setTimeout(() => {
          if (!claimAutoReload(sessionStorageOrUndefined(), Date.now())) {
            offerManualReload();
            return;
          }
          void adoSession.reloadHost("auto").then((requested) => {
            if (!requested) offerManualReload();
          });
          manualId = window.setTimeout(offerManualReload, AUTO_RELOAD_STALL_MS);
        }, BOOT_AUTO_RELOAD_AFTER_MS)
      : undefined;
    const { delayMs, giveUp } = planSessionRefreshRetry({
      recoverAtMs: refreshing.recoverAtMs,
      nowMs: Date.now(),
      attempt: refreshAttempt + 1,
    });
    if (giveUp) {
      // Auto-recovery exhausted — leave the manual "Reload page" action. Fire
      // the (idempotent) boot event so this terminal state is still measured
      // rather than looking like an infinite hang.
      markAppReady("error");
    }
    const id = giveUp ? undefined : window.setTimeout(retryBoot, delayMs);
    return () => {
      offRecovered();
      window.clearTimeout(reloadId);
      window.clearTimeout(manualId);
      window.clearTimeout(id);
    };
  }, [refreshing, refreshAttempt]);

  // Non-blocking diff fetch: once the file list is known, pull diff ranges and
  // original source. Failure degrades to "no diff data" without touching the
  // rendered Markdown.
  React.useEffect(() => {
    if (!ctx) return;
    const { repositoryId, projectId, baseCommit, targetCommit } = ctx;
    // Only MODIFIED files can be diffed in one batch: added/deleted/renamed
    // files don't exist at both commits under the same path, and getFileDiffs
    // fails the WHOLE request if any param path is missing at a version, which
    // would blank every file's diff (see diffableFilePaths).
    const diffPaths = diffableFilePaths(ctx.changedMdFiles);
    if (!baseCommit || !targetCommit || diffPaths.length === 0) return;
    let cancelled = false;
    void fetchFileDiffs(
      repositoryId,
      projectId,
      baseCommit,
      targetCommit,
      diffPaths,
    )
      .then((fileDiffs: Record<string, FileDiffInfo>) => {
        if (cancelled) return;
        const nextDiffs: Record<string, DiffRange[]> = {};
        const nextOriginalSources: Record<string, string> = {};
        for (const [path, info] of Object.entries(fileDiffs)) {
          if (info.ranges.length > 0) nextDiffs[path] = info.ranges;
          if (info.originalSource != null) {
            nextOriginalSources[path] = info.originalSource;
          }
        }
        setDiffsByFile(nextDiffs);
        setOriginalSourcesByFile(nextOriginalSources);
      })
      .catch((err: unknown) => {
        console.warn(
          "[PrTabApp] getFileDiffs failed; diffs will be empty",
          err,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  // Terminal boot states that never render Markdown still complete boot so a
  // single `app.loaded` event always fires. `markAppReady` is idempotent, so if
  // the document path renders first (PrShell fires "content"), these no-op.
  React.useEffect(() => {
    if (error) markAppReady("error");
  }, [error]);
  React.useEffect(() => {
    if (ctx && ctx.changedMdFiles.length === 0) markAppReady("empty");
  }, [ctx]);

  const loadFileSource = React.useCallback(
    async (path: string): Promise<string> => {
      if (!ctx) throw new Error("PR context not loaded yet");
      return fetchFileContent(ctx, path);
    },
    [ctx],
  );

  // The PR's web URL. ADO's PR REST payload carries no `_links.web`, so it is
  // assembled from the PR's org/project/repo/id (see `buildPrWebUrl`).
  const prWebUrl = React.useMemo(
    () =>
      ctx
        ? buildPrWebUrl(ctx.pr, {
            orgUrl: ctx.orgUrl,
            projectName: ctx.projectName,
            repositoryName: ctx.repositoryName,
            pullRequestId: ctx.pullRequestId,
          })
        : undefined,
    [ctx],
  );

  // Shareable-link builder ("Link to comment", heading links): the PR page with
  // our tab selected (`_a`), the open document (`path`), the compared updates
  // (`iteration` / `base`, unless All updates), and the target. Null when the
  // PR URL or extension identity can't be resolved — the link affordances are
  // then hidden rather than copying a dead iframe URL.
  const buildDeepLink = React.useMemo<DeepLinkBuilder | null>(() => {
    const ext = readExtensionIdentity();
    const base = ext
      ? buildPrTabDocUrl(prWebUrl, ext, activeDocPath, activeIterationParams)
      : undefined;
    return base ? (target) => withDeepLinkTarget(base, target) : null;
  }, [prWebUrl, activeDocPath, activeIterationParams]);

  // `[[_TOSP_]]` subpage tables list the page's folder as this PR has it —
  // or, for an earlier PR update, as that update had it.
  const listFolder = React.useMemo<FolderLister | undefined>(() => {
    const commitId =
      ctx?.targetCommit ?? ctx?.pr.lastMergeSourceCommit?.commitId;
    if (!ctx || !commitId) return undefined;
    const repo = {
      id: ctx.repositoryId,
      name: ctx.repositoryName,
      defaultBranch: "",
    };
    return (folderPath, atCommitId) =>
      listSubpageFolder(
        repo,
        ctx.projectId,
        folderPath,
        atCommitId ?? commitId,
      );
  }, [ctx]);

  // Which Markdown files a comparison of PR updates touches, so the file list
  // can mark them: ADO's iteration changes for the newer update compared to
  // the older one (0 = the PR base), paged.
  const loadRangeChanges = React.useCallback(
    async (range: ReviewIterationRange) => {
      if (!ctx) throw new Error("PR context not loaded yet");
      const params = iterationParamsForRange(range, ctx.reviewIterationStops);
      if (!params) return {};
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
    },
    [ctx],
  );

  const loadFileSourceAt = React.useCallback(
    async (path: string, commitId: string): Promise<string> => {
      if (!ctx) throw new Error("PR context not loaded yet");
      return fetchFileContentAtCommit(ctx, path, commitId);
    },
    [ctx],
  );

  const resolveDocumentImage = React.useCallback(
    async (
      documentPath: string,
      repositoryPath: string,
      atCommitId?: string,
    ): Promise<string | undefined> => {
      if (!ctx) return undefined;
      const changeType = ctx.changedMdFiles.find(
        (file) => file.path === documentPath,
      )?.changeType;
      const sourceCommit =
        atCommitId ??
        contentCommitForChange(changeType, {
          baseCommit: ctx.baseCommit ?? ctx.pr.lastMergeTargetCommit?.commitId,
          targetCommit:
            ctx.targetCommit ?? ctx.pr.lastMergeSourceCommit?.commitId,
        });
      const versionDescriptor = sourceCommit
        ? {
            version: sourceCommit,
            versionType: GitVersionType.Commit,
            versionOptions: GitVersionOptions.None,
          }
        : undefined;
      return resolveAdoRepositoryImageObjectUrl({
        repositoryId: ctx.repositoryId,
        project: ctx.projectId,
        path: repositoryPath,
        versionDescriptor,
      });
    },
    [ctx],
  );

  const commentApi = React.useMemo(() => {
    if (!ctx) return undefined;
    return new AdoCommentApi({
      repositoryId: ctx.repositoryId,
      pullRequestId: ctx.pullRequestId,
      project: ctx.projectId,
    });
  }, [ctx]);

  // Stable closure fetching the latest threads for this PR, used by PrShell's
  // `useThreadSync` to poll ~30s while visible. Must stay referentially stable.
  const fetchRemoteThreads = React.useCallback(
    async (_signal: AbortSignal) => {
      if (!ctx) return [];
      return loadAdoThreads(ctx.repositoryId, ctx.pullRequestId, ctx.projectId);
    },
    [ctx],
  );

  if (refreshing) {
    return (
      <div className="emr-error" role="status">
        <h2>Reconnecting to Azure DevOps…</h2>
        {refreshing.autoReload ? (
          <p style={{ color: "var(--emr-muted)" }}>This only takes a moment.</p>
        ) : (
          <>
            <p style={{ color: "var(--emr-muted)" }}>
              This usually fixes itself within a few minutes.
            </p>
            <button
              type="button"
              className="emr-error-retry"
              onClick={() => void adoSession.reloadHost("user")}
            >
              Reload page
            </button>
          </>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className="emr-error">
        <h2>Something went wrong</h2>
        <pre>{error}</pre>
        <button
          type="button"
          className="emr-error-retry"
          onClick={() => setBootAttempt((n) => n + 1)}
        >
          Try again
        </button>
      </div>
    );
  }

  if (!ctx || !user || !routeSeed) {
    return <ReaderLoadingShell scope="pr" ariaLabel="Loading pull request" />;
  }

  const pr: PrInfo = {
    prId: ctx.pullRequestId,
    title: ctx.pr.title ?? "(untitled PR)",
    authorName: ctx.pr.createdBy?.displayName ?? "unknown",
    files: ctx.changedMdFiles,
  };

  // Tell the comment rail which PR this view targets so it can render a pinned
  // pill. In the regular PR tab that's this very PR, but echoing it through the
  // rail keeps the UX consistent with the Documents-hub case.
  const routedPr: RoutedPrInfo = {
    prId: ctx.pullRequestId,
    title: ctx.pr.title ?? "(untitled PR)",
    status:
      ctx.pr.status === PullRequestStatus.Completed ? "completed" : "active",
    url: prWebUrl,
  };

  if (pr.files.length === 0) {
    return (
      <div className="emr-error" style={{ color: "var(--emr-muted)" }}>
        <h2>No Markdown files changed in this PR</h2>
        <p>
          This tab only shows .md files. Switch to the Files tab for the rest.
        </p>
      </div>
    );
  }

  // Mention-link hydration context — resolves work-item and PR mentions to
  // real ADO web URLs.
  const mentionLinks: MentionLinkResolution = {
    orgUrl: ctx.orgUrl,
    projectName: ctx.projectName,
    defaultRepoName: ctx.repositoryName || undefined,
  };

  const routePath = prTabRoutePath(activeDocPath);

  return (
    <MentionLinkContext.Provider value={mentionLinks}>
      <AvatarImageContext.Provider value={resolveAdoAvatarObjectUrl}>
        <DeepLinkContext.Provider value={buildDeepLink}>
          <PrShell
            pr={pr}
            listFolder={listFolder}
            loadFileSource={loadFileSource}
            resolveDocumentImage={resolveDocumentImage}
            diffsByFile={diffsByFile}
            originalSourcesByFile={originalSourcesByFile}
            initialThreads={EMPTY_INITIAL_THREADS}
            currentUser={user}
            commentApi={commentApi}
            routedPr={routedPr}
            draftScope="pr"
            fetchRemoteThreads={fetchRemoteThreads}
            reviewIterationStops={ctx.reviewIterationStops}
            reviewIterationBaseCommit={ctx.baseCommit}
            loadFileSourceAt={loadFileSourceAt}
            initialSelectedPath={routeSeed.selectedPath}
            initialActiveThreadId={routeSeed.threadId}
            initialAnchor={routeSeed.anchor}
            initialTextFragment={routeSeed.text}
            initialIterationRange={routeSeed.iterationRange}
            // Mirror the compared updates into the address bar and shared
            // links as ADO's own `iteration` / `base` (removed for All updates).
            onIterationRangeChange={(range) => {
              const params = range
                ? iterationParamsForRange(range, ctx.reviewIterationStops)
                : undefined;
              setActiveIterationParams(params);
              void writeRouteParams({
                [ITERATION_LINK_PARAM]: params ? String(params.iteration) : "",
                [BASE_LINK_PARAM]: params ? String(params.base) : "",
              });
            }}
            loadRangeChanges={loadRangeChanges}
            // TODO: replace placeholder with the real feedback alias.
            feedbackEmail="shubd3@gmail.com"
            // Keep the page URL a working share link: it always names the open
            // file, plus the active comment or the last copied heading.
            onSelectPath={(path) => {
              setActiveDocPath(path);
              void writeRouteParams({
                [PATH_LINK_PARAM]: prTabRoutePath(path),
                [ANCHOR_LINK_PARAM]: "",
                [COMMENT_LINK_PARAM]: "",
                [TEXT_LINK_PARAM]: "",
              });
            }}
            onActiveThreadChange={(threadId) => {
              void writeRouteParams(
                threadId
                  ? {
                      [PATH_LINK_PARAM]: routePath,
                      [COMMENT_LINK_PARAM]: threadId,
                      [ANCHOR_LINK_PARAM]: "",
                      [TEXT_LINK_PARAM]: "",
                    }
                  : { [COMMENT_LINK_PARAM]: "" },
              );
            }}
            onHeadingLinkCopied={(anchor) => {
              void writeRouteParams({
                [PATH_LINK_PARAM]: routePath,
                [ANCHOR_LINK_PARAM]: anchor,
                [COMMENT_LINK_PARAM]: "",
                [TEXT_LINK_PARAM]: "",
              });
            }}
            onTextLinkCopied={(text, anchor) => {
              void writeRouteParams({
                [PATH_LINK_PARAM]: routePath,
                [TEXT_LINK_PARAM]: text,
                [ANCHOR_LINK_PARAM]: anchor ?? "",
                [COMMENT_LINK_PARAM]: "",
              });
            }}
            onDocNavigate={(target) => {
              void openDocTarget(ctx, target);
            }}
          />
        </DeepLinkContext.Provider>
      </AvatarImageContext.Provider>
    </MentionLinkContext.Provider>
  );
}

// ---------------- helpers ----------------

async function resolvePrContext(
  log: (step: string, extra?: unknown) => void,
): Promise<PrContext> {
  log("reading SDK configuration");
  const config = SDK.getConfiguration() as Record<string, unknown> | undefined;
  log("sdk configuration", config);
  const pullRequestId = pickPullRequestId(
    config,
    typeof document !== "undefined" ? document.referrer : "",
  );
  if (!pullRequestId) {
    throw new Error(
      "Could not determine pull request id from SDK configuration. " +
        "Raw configuration: " +
        JSON.stringify(config, null, 2),
    );
  }
  log("resolved pullRequestId", pullRequestId);

  const project = await resolveCurrentProject();
  log("got project", project);

  const gitClient = sharedGitClient();
  const projectId = project.id;

  log("fetching pull request by id");
  // Timeout wraps the WHOLE retry sequence (not each attempt). `withTimeout`
  // can't cancel the underlying SDK request, so a per-attempt timeout would let
  // a timed-out-but-still-in-flight call stack up with its retries. Bounding
  // the entire `withRetry` instead means retries only fire on SETTLED
  // rejections (a real 4xx/5xx — no dangling request), while a genuinely hung
  // call still fails once after 15s rather than spinning forever.
  const prRequest = withTimeout(
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
  );

  // The PR's updates, then the latest update's changed files. Iteration
  // descriptions already carry the push's title, so commits aren't requested.
  const loadFileChanges = async (repositoryId: string) => {
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
    const latest = iterations[iterations.length - 1];
    if (!latest?.id) return { iterations, latest, changes: undefined };
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

  // The host passes the PR's repository with the tab's configuration, so the
  // updates load in parallel with the PR instead of after it.
  const { pr, changes: fileChanges } = await loadWithRepositoryHint(
    prRequest,
    configuredRepositoryId(config, pullRequestId),
    loadFileChanges,
  );
  const repositoryId = pr.repository.id;
  const repositoryName = pr.repository.name ?? "";
  const orgUrl = resolveOrgUrl();
  log("got pull request", { repositoryId, title: pr.title });

  const { iterations, latest, changes } = fileChanges;
  const reviewIterationStops = mapReviewIterationStops(
    iterations,
    pullRequestId,
  );
  if (!latest?.id || !changes) {
    log("no iterations; returning empty file list");
    return {
      projectId,
      projectName: project.name,
      repositoryId,
      repositoryName,
      orgUrl,
      pullRequestId,
      pr,
      changedMdFiles: [],
      reviewIterationStops,
    };
  }

  const mdEntries: { path: string; changeType: ChangeType }[] = [];
  for (const e of changes) {
    const path = markdownChangePath(e);
    if (!path) continue;
    mdEntries.push({ path, changeType: mapChangeType(e.changeType) });
  }

  // Return as soon as the Markdown file list is known so the shell can mount
  // and start rendering the first document immediately. Line counts (diffs) and
  // the comment threads are fetched OFF the critical path — diffs by the
  // component below, threads by PrShell's mount-time thread sync — so first
  // paint never waits on them.
  //
  // Diff against the iteration's MERGE BASE (three-dot), not the target
  // branch's moving tip, so highlights stay correct after master advances —
  // see `selectDiffCommits`.
  const { baseCommit, targetCommit } = selectDiffCommits(latest, pr);

  const changedMdFiles: FileInfo[] = mdEntries
    .map(
      (e) =>
        ({
          path: e.path,
          changeType: e.changeType,
          linesAdded: 0,
          linesDeleted: 0,
        }) satisfies FileInfo,
    )
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    projectId: project.id,
    projectName: project.name,
    repositoryId,
    repositoryName,
    orgUrl,
    pullRequestId,
    pr,
    changedMdFiles,
    baseCommit,
    targetCommit,
    reviewIterationStops,
  };
}

async function fetchFileContent(ctx: PrContext, path: string): Promise<string> {
  const changeType = ctx.changedMdFiles.find(
    (file) => file.path === path,
  )?.changeType;
  const sourceCommit = contentCommitForChange(changeType, {
    baseCommit: ctx.baseCommit ?? ctx.pr.lastMergeTargetCommit?.commitId,
    targetCommit: ctx.targetCommit ?? ctx.pr.lastMergeSourceCommit?.commitId,
  });
  return fetchFileContentAtCommit(ctx, path, sourceCommit);
}

async function fetchFileContentAtCommit(
  ctx: PrContext,
  path: string,
  commitId?: string,
): Promise<string> {
  const gitClient = sharedGitClient();
  const versionDescriptor = commitId
    ? {
        version: commitId,
        versionType: GitVersionType.Commit,
        versionOptions: GitVersionOptions.None,
      }
    : undefined;
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

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.stack || err.message;
  if (typeof err === "object" && err !== null)
    return JSON.stringify(err, null, 2);
  return String(err);
}

/**
 * The extension's publisher/extension ids (for the `_a` tab selector), or
 * `undefined` when the SDK context isn't available.
 */
function readExtensionIdentity():
  | { publisherId: string; extensionId: string }
  | undefined {
  try {
    return SDK.getExtensionContext();
  } catch {
    return undefined;
  }
}

/**
 * ADO Files `version` descriptor for the PR's source branch (`GB<branch>`), so
 * a non-markdown link opens the file as this PR sees it. Returns `undefined`
 * when the branch can't be resolved (Files then defaults to the repo's default
 * branch).
 */
function prBranchVersion(pr: GitPullRequest): string | undefined {
  const ref = pr.sourceRefName;
  if (!ref) return undefined;
  return "GB" + ref.replace(/^refs\/heads\//, "");
}

/**
 * Open a doc-link target that leaves the current PR view, in a new browser tab.
 * A markdown file that lives outside this PR opens in the Documents hub;
 * anything else (non-markdown, or a file not part of the PR) opens in the ADO
 * Files explorer at the PR's source branch. Best-effort — a missing navigation
 * service, extension context, or unresolvable URL is silently ignored (the
 * click just no-ops).
 */
async function openDocTarget(
  ctx: PrContext,
  target: DocLinkNavigation,
): Promise<void> {
  let url: string | undefined;
  if (target.kind === "repo-file") {
    url = buildReposFileUrl(
      ctx.orgUrl,
      ctx.projectName,
      ctx.repositoryName,
      target.path,
      prBranchVersion(ctx.pr),
    );
  } else {
    let ext: { publisherId: string; extensionId: string };
    try {
      ext = SDK.getExtensionContext();
    } catch (err) {
      trackUserFacingError({
        error: err,
        source: "PrTabApp.navigation",
        operation: "document-link-open",
        impact: "action-failed",
      });
      return;
    }
    url = buildHubDocUrl(
      ctx.orgUrl,
      ctx.projectName,
      ext,
      ctx.repositoryId,
      target.path,
    );
    // Carry a `#heading` from the link so the hub opens scrolled to it.
    if (url && target.hash) {
      url =
        withDeepLinkTarget(url, { kind: "heading", anchor: target.hash }) ??
        url;
    }
  }
  if (!url) return;
  try {
    const nav = await SDK.getService<IHostNavigationService>(
      CommonServiceIds.HostNavigationService,
    );
    nav.openNewWindow(url, "");
  } catch (err) {
    // Best-effort: the doc just doesn't open. Surface the failure for
    // diagnostics (matching the console.warn pattern in the ADO data layer)
    // rather than swallowing it silently.
    console.warn("[pr-tab] opening doc link failed:", err);
    trackUserFacingError({
      error: err,
      source: "PrTabApp.navigation",
      operation: "document-link-open",
      impact: "action-failed",
    });
  }
}

/**
 * Read the PR tab's deep-link targets (`?path=`, `?comment=`, `?anchor=`) from
 * the host's query params. Best-effort: an unavailable navigation service
 * yields no targets (the tab opens normally).
 */
async function readRouteSeed(
  files: readonly FileInfo[],
  stops: readonly HistoryStop[],
): Promise<PrTabRouteSeed> {
  let params: Record<string, string> = {};
  try {
    const nav = await SDK.getService<IHostNavigationService>(
      CommonServiceIds.HostNavigationService,
    );
    params = (await nav.getQueryParams()) ?? {};
  } catch {
    /* navigation service unavailable — open without deep-link targets */
  }
  return resolvePrTabRouteSeed(params, files, stops);
}

/**
 * Merge `updates` into the host page's query string (an empty value removes a
 * param), so the address bar mirrors the open file + active comment or heading
 * and is itself a shareable link. Best-effort: a missing navigation service is
 * silently ignored.
 */
async function writeRouteParams(
  updates: Record<string, string>,
): Promise<void> {
  try {
    const nav = await SDK.getService<IHostNavigationService>(
      CommonServiceIds.HostNavigationService,
    );
    nav.setQueryParams(updates);
  } catch {
    /* navigation service unavailable — route syncing is best-effort */
  }
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
    const host = SDK.getHost();
    if (host?.name) return `https://dev.azure.com/${host.name}`;
  } catch {
    // Falls through to the referrer-based heuristic.
  }
  try {
    const ref = document.referrer;
    if (ref) {
      const u = new URL(ref);
      const segments = u.pathname.split("/").filter(Boolean);
      if (segments.length > 0) return `${u.origin}/${segments[0]}`;
      return u.origin;
    }
  } catch {
    // Falls through.
  }
  return "";
}
