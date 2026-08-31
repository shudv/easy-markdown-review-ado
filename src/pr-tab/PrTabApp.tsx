// Top-level component for the Markdown Review PR tab in real ADO. Discovers
// the active PR/project via the SDK, lists the changed `.md` files, loads
// emr-authored threads, and feeds a PrInfo +
// loadFileSource closure + thread CommentApi into the shared <PrShell/>.

import * as React from "react";
import * as SDK from "azure-devops-extension-sdk";
import {
  CommonServiceIds,
  getClient,
  IProjectPageService,
  type IHostNavigationService,
} from "azure-devops-extension-api";
import {
  GitRestClient,
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
import type { HistoryStop } from "../shell/prShellHelpers";
import { ReaderLoadingShell } from "../shell/components/ReaderLoadingShell";
import { AvatarImageContext } from "../shell/components/Avatar";
import { resolveAdoAvatarObjectUrl } from "../shell/adoGitData";
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
  CommentLinkContext,
  withCommentParam,
  readCommentParam,
  COMMENT_LINK_PARAM,
  type CommentLinkBuilder,
} from "../comments/commentLink";
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
  ensureAdoSessionLive,
  planSessionRefreshRetry,
  type AdoGrantState,
} from "../shell/adoAuthToken";
import {
  buildPrWebUrl,
  contentCommitForChange,
  diffableFilePaths,
  mapChangeType,
  pickPullRequestId,
  reviewIterationStops as mapReviewIterationStops,
  selectDiffCommits,
  withTimeout,
} from "./prTabApp.helpers";

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
  } | null>(null);
  // How many auto-retries we've scheduled for the current refreshing spell, so
  // `planSessionRefreshRetry` can bound them before falling back to manual.
  const [refreshAttempt, setRefreshAttempt] = React.useState(0);
  // Deep-link target from the `?comment=` route param (read once at startup).
  const [initialActiveThreadId, setInitialActiveThreadId] = React.useState<
    string | undefined
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
        const context = await resolvePrContext(log);
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
        setInitialActiveThreadId(await readCommentRouteParam());
        log("ready");
      } catch (err: unknown) {
        const refresh = await detectSessionRefreshing(err, () =>
          SDK.getAccessToken(),
        );
        if (refresh) {
          console.warn("[PrTabApp] ADO session refreshing", refresh.grantState);
          trackUserFacingError({
            error: refresh,
            source: "PrTabApp.context",
            operation: "session-refresh",
            impact: "degraded",
          });
          markBootAuthWaitStart();
          setRefreshing({
            state: refresh.grantState,
            recoverAtMs: refresh.recoverAtMs,
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

  // Auto-recover from the token dead-window: wait until the host is expected to
  // have minted a fresh token (the AAD `exp`, per `recoverAtMs`), then re-run
  // boot. Bounded by `planSessionRefreshRetry`; once exhausted the user falls
  // back to the manual "Reload page" action.
  React.useEffect(() => {
    if (!refreshing) return;
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
      return;
    }
    const id = window.setTimeout(() => {
      markBootAuthWaitEnd();
      setRefreshAttempt((n) => n + 1);
      setRefreshing(null);
      setError(null);
      setBootAttempt((n) => n + 1);
    }, delayMs);
    return () => window.clearTimeout(id);
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
      <div className="emr-error">
        <h2>Refreshing your Azure DevOps session…</h2>
        <p style={{ color: "var(--emr-muted)" }}>
          Your access token just expired and Azure DevOps is issuing a new one.
          This tab retries on its own in a moment. If it doesn’t clear, reload
          the page to refresh your session now.
        </p>
        <button
          type="button"
          className="emr-error-retry"
          onClick={() => void reloadHostPage()}
        >
          Reload page
        </button>
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

  if (!ctx || !user) {
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
    url: buildPrWebUrl(ctx.pr),
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

  // "Link to comment" builder: the PR page URL with our tab selected (`_a`)
  // plus the thread id. Null when the PR web URL / tab id can't be resolved.
  const prTabBaseUrl = buildPrTabUrl(ctx);
  const buildCommentLink: CommentLinkBuilder | null = prTabBaseUrl
    ? (threadId: string) => withCommentParam(prTabBaseUrl, threadId)
    : null;

  return (
    <MentionLinkContext.Provider value={mentionLinks}>
      <AvatarImageContext.Provider value={resolveAdoAvatarObjectUrl}>
        <CommentLinkContext.Provider value={buildCommentLink}>
          <PrShell
            pr={pr}
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
            initialActiveThreadId={initialActiveThreadId}
            feedbackEmail="shubd3@gmail.com"
            onActiveThreadChange={(threadId) => {
              void writeCommentRouteParam(threadId);
            }}
            onDocNavigate={(target) => {
              void openDocTarget(ctx, target);
            }}
          />
        </CommentLinkContext.Provider>
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

  log("getting project page service");
  const projectService = await SDK.getService<IProjectPageService>(
    CommonServiceIds.ProjectPageService,
  );
  log("got project page service; loading project");
  const project = await projectService.getProject();
  if (!project) throw new Error("No active project on the page.");
  log("got project", { id: project.id, name: project.name });

  log("creating git client");
  const gitClient = getClient(GitRestClient);

  // Pre-flight the host token BEFORE the first REST call. During the ~10 min
  // "dead window" (the token's embedded ADO grant `ado_exp` has lapsed but its
  // AAD `exp` has not) the host keeps serving a token ADO rejects as anonymous
  // (TF400813). A tight retry can't heal that — it just replays the same cached
  // token — so we surface a SessionRefreshingError instead and let the UI wait
  // for the guaranteed re-mint (or offer a host reload) rather than burning the
  // retry budget on a doomed request.
  await ensureAdoSessionLive(() => SDK.getAccessToken());

  log("fetching pull request by id");
  // Timeout wraps the WHOLE retry sequence (not each attempt). `withTimeout`
  // can't cancel the underlying SDK request, so a per-attempt timeout would let
  // a timed-out-but-still-in-flight call stack up with its retries. Bounding
  // the entire `withRetry` instead means retries only fire on SETTLED
  // rejections (a real 4xx/5xx — no dangling request), while a genuinely hung
  // call still fails once after 15s rather than spinning forever.
  const pr = await withTimeout(
    withRetry(() => gitClient.getPullRequestById(pullRequestId, project.id), {
      mode: "read",
      label: "getPullRequestById",
    }),
    15_000,
    `getPullRequestById(${pullRequestId}, ${project.id})`,
  );
  const repositoryId = pr.repository.id;
  const repositoryName = pr.repository.name ?? "";
  const orgUrl = resolveOrgUrl();
  log("got pull request", { repositoryId, title: pr.title });

  log("fetching pull request iterations");
  const iterations = await withRetry(
    () =>
      gitClient.getPullRequestIterations(
        repositoryId,
        pullRequestId,
        project.id,
        true,
      ),
    { mode: "read", label: "getPullRequestIterations" },
  );
  const latest = iterations[iterations.length - 1];
  const reviewIterationStops = mapReviewIterationStops(
    iterations,
    pullRequestId,
  );
  if (!latest?.id) {
    log("no iterations; returning empty file list");
    return {
      projectId: project.id,
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
  log("fetching iteration changes", latest.id);
  const changes = await withRetry(
    () =>
      gitClient.getPullRequestIterationChanges(
        repositoryId,
        pullRequestId,
        latest.id,
        project.id,
      ),
    { mode: "read", label: "getPullRequestIterationChanges" },
  );

  const mdEntries: { path: string; changeType: ChangeType }[] = [];
  for (const e of changes.changeEntries ?? []) {
    const path = e.item?.path ?? "";
    if (!path || !path.toLowerCase().endsWith(".md")) continue;
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
  const gitClient = getClient(GitRestClient);
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
 * Reload the HOST page (not our iframe) so the host re-initializes its token
 * manager and mints a fresh token immediately. Reloading the iframe alone would
 * leave the host's cached (dead) token in place, so this must go through the
 * navigation service. Best-effort.
 */
async function reloadHostPage(): Promise<void> {
  try {
    const nav = await SDK.getService<IHostNavigationService>(
      CommonServiceIds.HostNavigationService,
    );
    nav.reload();
  } catch {
    /* navigation service unavailable — nothing else we can safely do */
  }
}

/**
 * Absolute base URL for a deep link into this tab: the PR's web URL with the
 * `_a` tab-selector set to our PR-tab contribution
 * (`<publisher>.<extension>.markdown-review-pr-tab`). Returns `undefined` when
 * the PR web URL or extension context can't be resolved, so callers fall back
 * to the in-iframe hash link.
 */
function buildPrTabUrl(ctx: PrContext): string | undefined {
  const web = buildPrWebUrl(ctx.pr);
  if (!web) return undefined;
  let ext: { publisherId: string; extensionId: string };
  try {
    ext = SDK.getExtensionContext();
  } catch {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(web);
  } catch {
    return undefined;
  }
  url.searchParams.set(
    "_a",
    `${ext.publisherId}.${ext.extensionId}.markdown-review-pr-tab`,
  );
  return url.toString();
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
 * Read the `?comment=` deep-link target from the host's query params.
 * Best-effort: returns `undefined` when the navigation service is unavailable.
 */
async function readCommentRouteParam(): Promise<string | undefined> {
  try {
    const nav = await SDK.getService<IHostNavigationService>(
      CommonServiceIds.HostNavigationService,
    );
    return readCommentParam((await nav.getQueryParams()) ?? {});
  } catch {
    return undefined;
  }
}

/**
 * Mirror the active thread into the host's `?comment=` query param (the
 * inverse of {@link readCommentRouteParam}) so selecting a comment yields the
 * same shareable deep link the "Link to comment" action produces. Passing
 * `null` clears the param (empty value removes it). Best-effort: a missing
 * navigation service is silently ignored.
 */
async function writeCommentRouteParam(threadId: string | null): Promise<void> {
  try {
    const nav = await SDK.getService<IHostNavigationService>(
      CommonServiceIds.HostNavigationService,
    );
    nav.setQueryParams({ [COMMENT_LINK_PARAM]: threadId ?? "" });
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
