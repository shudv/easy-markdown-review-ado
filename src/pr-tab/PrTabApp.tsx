// Top-level component for the Markdown Review PR tab in real ADO. Discovers
// the active PR/project via the SDK, lists the changed `.md` files, loads
// emr-authored threads, and feeds a PrInfo +
// loadFileSource closure + thread CommentApi into the shared <Shell/>.

import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import * as SDK from "azure-devops-extension-sdk";
import { PullRequestStatus } from "azure-devops-extension-api/Git";

import { Shell, type RoutedPrInfo } from "../shell/Shell";
import type { ReviewIterationRange } from "../shell/shellHelpers";
import { ReaderLoadingShell } from "../shell/components/ReaderLoadingShell";
import { AvatarImageContext } from "../shell/components/Avatar";
import {
  listSubpageFolder,
  resolveAdoAvatarObjectUrl,
} from "../shell/adoGitData";
import type { FolderLister } from "../shell/wikiOrder";
import { resolveAdoRepositoryImageObjectUrl } from "../shell/adoRepositoryImages";
import { formatError } from "../hub/documentsHub.helpers";
import type { CommentAuthor, CommentThread, DiffRange, PrInfo } from "../types";
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
import {
  detectSessionRefreshing,
  planSessionRefreshRetry,
  type AdoGrantState,
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
  diffableFilePaths,
  hasText,
  prTabRoutePath,
  type IterationParams,
  type PrTabRouteSeed,
} from "./prTabApp.helpers";
import {
  commentAuthorFromUser,
  contentCommitForPath,
  splitFileDiffs,
  type PrContext,
} from "./prContext.helpers";
import {
  commitVersionDescriptor,
  fetchFileContent,
  fetchFileContentAtCommit,
  fetchRangeChangeTypes,
  resolvePrContext,
} from "./prContext";
import {
  openDocTarget,
  readExtensionIdentity,
  readRouteSeed,
  writeRouteParams,
} from "./prTabHost";
import {
  BootErrorView,
  NoMarkdownFilesView,
  SessionRefreshingView,
} from "./PrTabStatusViews";

// Stable empty array: threads load after mount via Shell's thread sync, so
// the shell seeds its reducer with this instead of blocking first paint on the
// thread fetch. Module-scoped so its identity never changes across renders.
const EMPTY_INITIAL_THREADS: CommentThread[] = [];

// eslint-disable-next-line max-lines-per-function -- PR tab root inside the Azure DevOps SDK: boot states, PR context, update comparison and routing into Shell. Logic is extracted to tested modules; the rest is host wiring.
export function PrTabApp(): ReactElement {
  const [ctx, setCtx] = useState<PrContext | null>(null);
  const [user, setUser] = useState<CommentAuthor | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by the boot error's "Try again" to re-run context resolution. A
  // transient auth blip (a 401 on the first git call, most common on the legacy
  // {org}.visualstudio.com host) clears on a fresh attempt with a warm token.
  const [bootAttempt, setBootAttempt] = useState(0);
  // Set when a boot failure is the token dead-window (see adoAuthToken.ts): the
  // host is serving an ADO-expired token, so only a re-mint (auto at the AAD
  // `exp`, or a host reload) can heal it. Kept distinct from `error` so the UI
  // shows an accurate "refreshing" state instead of a raw TF400813.
  const [refreshing, setRefreshing] = useState<{
    state: AdoGrantState;
    recoverAtMs?: number;
    /** An automatic host reload is allowed (see `claimAutoReload`). */
    autoReload: boolean;
  } | null>(null);
  // How many auto-retries we've scheduled for the current refreshing spell, so
  // `planSessionRefreshRetry` can bound them before falling back to manual.
  const [refreshAttempt, setRefreshAttempt] = useState(0);
  // Deep-link targets from the route (`?path=`, `?comment=`, `?anchor=`), read
  // once at startup. `null` until read, so the shell mounts on the right file.
  const [routeSeed, setRouteSeed] = useState<PrTabRouteSeed | null>(null);
  // The document on screen — encoded into shared links so they open the same
  // file. Seeded from the route (or the first changed file) once known.
  const [activeDocPath, setActiveDocPath] = useState("");
  // The compared PR updates as ADO iteration ids, for shared links and the
  // address bar. `undefined` = "All updates" (left out of links).
  const [activeIterationParams, setActiveIterationParams] = useState<
    IterationParams | undefined
  >(undefined);
  // Per-file diff data, fetched OFF the critical path (see the effect below).
  // Starts empty so the shell renders Markdown immediately; diff decorations
  // fill in when this resolves.
  const [diffsByFile, setDiffsByFile] = useState<Record<string, DiffRange[]>>(
    {},
  );
  const [originalSourcesByFile, setOriginalSourcesByFile] = useState<
    Record<string, string>
  >({});
  useEffect(() => {
    void (async () => {
      setError(null);
      setRefreshing(null);
      const log = (step: string, extra?: unknown) => {
        // eslint-disable-next-line no-console -- boot step trace in the host DevTools console, for diagnosing PR tab boot problems in a real org
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
        setUser(commentAuthorFromUser(SDK.getUser()));
        const seed = await readRouteSeed(
          context.changedMdFiles,
          context.reviewIterationStops,
        );
        setActiveDocPath(
          seed.selectedPath ??
            (context.changedMdFiles.length > 0
              ? context.changedMdFiles[0]!.path
              : ""),
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
  useEffect(() => {
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
  useEffect(() => {
    if (!ctx) return;
    const { repositoryId, projectId, baseCommit, targetCommit } = ctx;
    // Only MODIFIED files can be diffed in one batch: added/deleted/renamed
    // files don't exist at both commits under the same path, and getFileDiffs
    // fails the WHOLE request if any param path is missing at a version, which
    // would blank every file's diff (see diffableFilePaths).
    const diffPaths = diffableFilePaths(ctx.changedMdFiles);
    if (
      !hasText(baseCommit) ||
      !hasText(targetCommit) ||
      diffPaths.length === 0
    )
      return;
    let cancelled = false;
    void fetchFileDiffs(
      { repositoryId, project: projectId, baseCommit, targetCommit },
      diffPaths,
    )
      .then((fileDiffs: Record<string, FileDiffInfo>) => {
        if (cancelled) return;
        const { diffs, originalSources } = splitFileDiffs(fileDiffs);
        setDiffsByFile(diffs);
        setOriginalSourcesByFile(originalSources);
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
  // the document path renders first (Shell fires "content"), these no-op.
  useEffect(() => {
    if (error !== null && error !== "") markAppReady("error");
  }, [error]);
  useEffect(() => {
    if (ctx?.changedMdFiles.length === 0) markAppReady("empty");
  }, [ctx]);

  const loadFileSource = useCallback(
    async (path: string): Promise<string> => {
      if (!ctx) throw new Error("PR context not loaded yet");
      return fetchFileContent(ctx, path);
    },
    [ctx],
  );

  // The PR's web URL. ADO's PR REST payload carries no `_links.web`, so it is
  // assembled from the PR's org/project/repo/id (see `buildPrWebUrl`).
  const prWebUrl = useMemo(
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
  const buildDeepLink = useMemo<DeepLinkBuilder | null>(() => {
    const ext = readExtensionIdentity();
    const base = ext
      ? buildPrTabDocUrl(prWebUrl, ext, activeDocPath, activeIterationParams)
      : undefined;
    return hasText(base) ? (target) => withDeepLinkTarget(base, target) : null;
  }, [prWebUrl, activeDocPath, activeIterationParams]);

  // `[[_TOSP_]]` subpage tables list the page's folder as this PR has it —
  // or, for an earlier PR update, as that update had it.
  const listFolder = useMemo<FolderLister | undefined>(() => {
    // Typed required, but the ADO REST payload omits it on some PRs.
    const prRefs:
      | { lastMergeSourceCommit?: { commitId?: string } }
      | undefined = ctx?.pr;
    const commitId =
      ctx?.targetCommit ?? prRefs?.lastMergeSourceCommit?.commitId;
    if (!ctx || !hasText(commitId)) return undefined;
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
  const loadRangeChanges = useCallback(
    async (range: ReviewIterationRange) => {
      if (!ctx) throw new Error("PR context not loaded yet");
      const params = iterationParamsForRange(range, ctx.reviewIterationStops);
      if (!params) return {};
      return fetchRangeChangeTypes(ctx, params);
    },
    [ctx],
  );

  const loadFileSourceAt = useCallback(
    async (path: string, commitId: string): Promise<string> => {
      if (!ctx) throw new Error("PR context not loaded yet");
      return fetchFileContentAtCommit(ctx, path, commitId);
    },
    [ctx],
  );

  const resolveDocumentImage = useCallback(
    async (
      documentPath: string,
      repositoryPath: string,
      atCommitId?: string,
    ): Promise<string | undefined> => {
      if (!ctx) return undefined;
      const sourceCommit =
        atCommitId ?? contentCommitForPath(ctx, documentPath);
      return resolveAdoRepositoryImageObjectUrl({
        repositoryId: ctx.repositoryId,
        project: ctx.projectId,
        path: repositoryPath,
        versionDescriptor: commitVersionDescriptor(sourceCommit),
      });
    },
    [ctx],
  );

  const commentApi = useMemo(() => {
    if (!ctx) return undefined;
    return new AdoCommentApi({
      repositoryId: ctx.repositoryId,
      pullRequestId: ctx.pullRequestId,
      project: ctx.projectId,
    });
  }, [ctx]);

  // Stable closure fetching the latest threads for this PR, used by Shell's
  // `useThreadSync` to poll ~30s while visible. Must stay referentially stable.
  const fetchRemoteThreads = useCallback(
    async (_signal: AbortSignal) => {
      if (!ctx) return [];
      return loadAdoThreads(ctx.repositoryId, ctx.pullRequestId, ctx.projectId);
    },
    [ctx],
  );

  if (refreshing) {
    return (
      <SessionRefreshingView
        autoReload={refreshing.autoReload}
        onReload={() => void adoSession.reloadHost("user")}
      />
    );
  }

  if (error !== null && error !== "") {
    return (
      <BootErrorView
        error={error}
        onRetry={() => setBootAttempt((n) => n + 1)}
      />
    );
  }

  if (!ctx || !user || !routeSeed) {
    return <ReaderLoadingShell scope="pr" ariaLabel="Loading pull request" />;
  }

  // `title` / `createdBy` are typed required but can be absent from the REST
  // payload.
  const prTitle = (ctx.pr.title as string | undefined) ?? "(untitled PR)";
  const createdBy = ctx.pr.createdBy as { displayName?: string } | undefined;
  const pr: PrInfo = {
    prId: ctx.pullRequestId,
    title: prTitle,
    authorName: createdBy?.displayName ?? "unknown",
    files: ctx.changedMdFiles,
  };

  // Tell the comment rail which PR this view targets so it can render a pinned
  // pill. In the regular PR tab that's this very PR, but echoing it through the
  // rail keeps the UX consistent with the Documents-hub case.
  const routedPr: RoutedPrInfo = {
    prId: ctx.pullRequestId,
    title: prTitle,
    status:
      ctx.pr.status === PullRequestStatus.Completed ? "completed" : "active",
    url: prWebUrl,
  };

  if (pr.files.length === 0) {
    return <NoMarkdownFilesView />;
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
          <Shell
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
                threadId !== null && threadId !== ""
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
