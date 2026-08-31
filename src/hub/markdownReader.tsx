// Shared single-file Markdown reader used by the full-page Documents hub
// (`../hub/markdownReviewHub.tsx`) when a specific file is deep-linked via the
// hub URL query params (e.g. a bookmarked / shared link).
//
// It renders the rendered Markdown + comments by reusing <PrShell hideDocNav/>
// — the same shell the PR tab uses, minus the file-tree navigation — and owns
// all of the ADO data loading (repo lookup, PR routing, threads, current user,
// file content). Callers only supply a `ReaderConfig` describing the target
// file; how that config is obtained (URL query params for the hub) is the
// caller's concern.

import * as React from "react";
import * as SDK from "azure-devops-extension-sdk";
import { getClient } from "azure-devops-extension-api";
import {
  GitRestClient,
  GitVersionOptions,
  GitVersionType,
  type GitPullRequest,
  type GitRepository,
} from "azure-devops-extension-api/Git";
import { resolveAdoRepositoryImageObjectUrl } from "../shell/adoRepositoryImages";
import { PrShell, type RoutedPrInfo } from "../shell/PrShell";
import { AvatarImageContext } from "../shell/components/Avatar";
import { ReaderLoadingShell } from "../shell/components/ReaderLoadingShell";
import { AdoCommentApi } from "../shell/adoCommentApi";
import {
  loadRepoPrRouting,
  loadThreadsForRepo,
  resolveAdoAvatarObjectUrl,
} from "../shell/adoGitData";
import { identityAvatarUrl } from "../shell/adoGitData.helpers";
import { parseVersionSpec } from "./markdownReader.helpers";
import type { CommentApi } from "../comments/api";
import type { CommentAuthor, CommentThread, PrInfo } from "../types";
import { markAppReady, trackUserFacingError } from "../telemetry";

/** Target descriptor handed to the reader by the launching surface. */
export interface ReaderConfig {
  repositoryId: string;
  repositoryName?: string;
  project: string;
  path: string;
  /** ADO version spec, e.g. "GBmain" (branch), "GCsha" (commit), "GTtag". */
  version?: string;
}

interface ResolvedReader {
  config: ReaderConfig;
  rawRepo: GitRepository;
  /** Routing PR the comments thread through, or null for a read-only reader. */
  pr: GitPullRequest | null;
  routedPr?: RoutedPrInfo;
  initialThreads: CommentThread[];
}

/**
 * Translate an ADO version spec ("GB<branch>" / "GC<commit>" / "GT<tag>") into
 * the GitRestClient version descriptor. Falls back to the repo's default
 * branch when the spec is missing or unrecognised.
 */
function versionDescriptorFor(
  spec: string | undefined,
  rawRepo: GitRepository,
): {
  version: string;
  versionType: GitVersionType;
  versionOptions: GitVersionOptions;
} {
  const fallback = {
    version: stripRefsHeads(rawRepo.defaultBranch) || "main",
    versionType: GitVersionType.Branch,
    versionOptions: GitVersionOptions.None,
  };
  const parsed = parseVersionSpec(spec);
  if (!parsed) return fallback;
  const versionType =
    parsed.kind === "commit"
      ? GitVersionType.Commit
      : parsed.kind === "tag"
        ? GitVersionType.Tag
        : GitVersionType.Branch;
  return {
    version: parsed.value,
    versionType,
    versionOptions: GitVersionOptions.None,
  };
}

function stripRefsHeads(ref: string | undefined): string {
  if (!ref) return "";
  return ref.replace(/^refs\/heads\//, "");
}

async function fetchReaderFileContent(
  resolved: ResolvedReader,
): Promise<string> {
  const { config, rawRepo } = resolved;
  const gitClient = getClient(GitRestClient);
  const descriptor = versionDescriptorFor(config.version, rawRepo);
  const ab = await gitClient.getItemContent(
    config.repositoryId,
    config.path,
    config.project,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    descriptor,
    true,
  );
  return new TextDecoder("utf-8").decode(new Uint8Array(ab));
}

function basename(path: string): string {
  const clean = path.replace(/\/+$/, "");
  const idx = clean.lastIndexOf("/");
  return idx >= 0 ? clean.slice(idx + 1) : clean;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * Render a single Markdown file (rendered prose + inline comments) for the
 * given target. Owns all ADO data loading; surfaces loading/error states.
 */
export function MarkdownReader({
  config,
}: {
  config: ReaderConfig;
}): React.ReactElement {
  const [resolved, setResolved] = React.useState<ResolvedReader | null>(null);
  const [user, setUser] = React.useState<CommentAuthor | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void (async () => {
      try {
        const gitClient = getClient(GitRestClient);
        const rawRepo = await gitClient.getRepository(
          config.repositoryId,
          config.project,
        );

        // Route comments through the repo's most recent completed PR,
        // exactly like the Documents hub. No PR → read-only reader.
        const { recentPr, pr } = await loadRepoPrRouting(
          rawRepo,
          config.project,
        );

        let initialThreads: CommentThread[] = [];
        if (pr && typeof pr.pullRequestId === "number") {
          const prByRepo = { [config.repositoryId]: pr };
          const all = await loadThreadsForRepo(
            config.repositoryId,
            config.project,
            prByRepo,
          );
          // Single-file reader: only threads anchored to this file.
          initialThreads = all.filter((t) => t.filePath === config.path);
        }

        const routedPr: RoutedPrInfo | undefined = recentPr
          ? {
              prId: recentPr.id,
              title: recentPr.title,
              status: recentPr.status,
              url: recentPr.url,
            }
          : undefined;

        setResolved({
          config,
          rawRepo,
          pr: pr && typeof pr.pullRequestId === "number" ? pr : null,
          routedPr,
          initialThreads,
        });

        const u = SDK.getUser();
        setUser({
          id: u.id,
          displayName: u.displayName,
          initials: initialsOf(u.displayName),
          avatarUrl: identityAvatarUrl(u),
        });
      } catch (err: unknown) {
        console.error("[MarkdownReader] load failed", err);
        trackUserFacingError({
          error: err,
          source: "MarkdownReader.load",
          operation: "reader-context-load",
          impact: "blocking",
        });
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [config]);

  const loadFileSource = React.useCallback(
    (_path: string): Promise<string> => {
      if (!resolved) return Promise.reject(new Error("Reader not ready"));
      return fetchReaderFileContent(resolved);
    },
    [resolved],
  );
  const resolveDocumentImage = React.useCallback(
    async (
      _documentPath: string,
      repositoryPath: string,
      atCommitId?: string,
    ): Promise<string | undefined> => {
      if (!resolved) return undefined;
      const versionDescriptor = atCommitId
        ? {
            version: atCommitId,
            versionType: GitVersionType.Commit,
            versionOptions: GitVersionOptions.None,
          }
        : versionDescriptorFor(resolved.config.version, resolved.rawRepo);
      return resolveAdoRepositoryImageObjectUrl({
        repositoryId: resolved.config.repositoryId,
        project: resolved.config.project,
        path: repositoryPath,
        versionDescriptor,
      });
    },
    [resolved],
  );

  const commentApi = React.useMemo<CommentApi | undefined>(() => {
    if (!resolved?.pr) return undefined;
    return new AdoCommentApi({
      repositoryId: resolved.config.repositoryId,
      pullRequestId: resolved.pr.pullRequestId,
      project: resolved.config.project,
    });
  }, [resolved]);

  const fetchRemoteThreads = React.useMemo<
    ((signal: AbortSignal) => Promise<CommentThread[]>) | undefined
  >(() => {
    if (!resolved?.pr) return undefined;
    const { config: cfg, pr } = resolved;
    const prByRepo = { [cfg.repositoryId]: pr };
    const abortError = (): Error =>
      typeof DOMException !== "undefined"
        ? new DOMException("Aborted", "AbortError")
        : Object.assign(new Error("Aborted"), { name: "AbortError" });
    return async (signal: AbortSignal): Promise<CommentThread[]> => {
      if (signal.aborted) throw abortError();
      const all = await loadThreadsForRepo(
        cfg.repositoryId,
        cfg.project,
        prByRepo,
      );
      if (signal.aborted) throw abortError();
      return all.filter((t) => t.filePath === cfg.path);
    };
  }, [resolved]);

  // Boot-time completion for the reader's terminal error state, which bypasses
  // PrShell (whose "content"/"error" signal covers the success + render-failure
  // paths). Without this a data-load failure here would drop the boot event.
  // Idempotent + no-ops outside a real boot.
  React.useEffect(() => {
    if (error) markAppReady("error");
  }, [error]);

  if (error) {
    return (
      <div className="emr-error" role="alert">
        <h2>Couldn’t open Markdown Review</h2>
        <pre>{error}</pre>
      </div>
    );
  }

  if (!resolved || !user) {
    return (
      <ReaderLoadingShell scope="hub" ariaLabel="Loading document" hideDocNav />
    );
  }

  const fileName = basename(resolved.config.path);
  const pr: PrInfo = {
    prId: resolved.pr?.pullRequestId ?? 0,
    title: fileName,
    authorName: user.displayName,
    files: [
      {
        path: resolved.config.path,
        changeType: "modified",
        linesAdded: 0,
        linesDeleted: 0,
      },
    ],
  };

  const readOnly = !resolved.pr;
  const readOnlyMessage = readOnly
    ? `${resolved.config.repositoryName ?? "This repository"} has no completed pull request — commenting is disabled until one is completed.`
    : undefined;

  return (
    <AvatarImageContext.Provider value={resolveAdoAvatarObjectUrl}>
      <PrShell
        hideDocNav
        pr={pr}
        loadFileSource={loadFileSource}
        resolveDocumentImage={resolveDocumentImage}
        diffsByFile={{}}
        initialThreads={resolved.initialThreads}
        currentUser={user}
        commentApi={commentApi}
        routedPr={resolved.routedPr}
        draftScope="hub"
        readOnly={readOnly}
        readOnlyMessage={readOnlyMessage}
        fetchRemoteThreads={fetchRemoteThreads}
      />
    </AvatarImageContext.Provider>
  );
}
