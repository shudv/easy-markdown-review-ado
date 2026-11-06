// One level of a repository folder for the Documents hub tree and wiki
// subpages: a OneLevel `getItems` read projected to `.md` files + subfolders,
// ordered by the folder's wiki `.order` file when it has one. The Git client is
// injected so this stays loadable (and testable) under Node.

import type {
  GitItem,
  GitRepository,
  GitRestClient,
  GitVersionDescriptor,
} from "azure-devops-extension-api/Git";

import { trackUserFacingError } from "../telemetry";
import { withRetry } from "./retry";
import { isItemNotFoundError } from "./shellHelpers";
import type { FolderListing } from "./types";
import {
  findOrderFile,
  listingFailureOutcome,
  projectMarkdownLevel,
  stripRefsHeads,
  type GitScope,
} from "./adoGitData.helpers";
import { parseOrderFile } from "./wikiOrder";

type FolderListingClient = Pick<GitRestClient, "getItems" | "getItemText">;

/** The repository fields a folder listing reads. */
export type ListedRepo = Pick<GitRepository, "id" | "name" | "defaultBranch">;

/** How {@link listMarkdownLevel} pins and reports a listing. */
interface ListLevelOptions {
  atCommitId?: string;
  missingOk?: boolean;
  propagate?: boolean;
}

/** One folder read: the client, where to read, and at which version. */
interface LevelRead {
  gitClient: FolderListingClient;
  projectId: string;
  repo: ListedRepo;
  scopePath: string;
  versionDescriptor: GitVersionDescriptor;
}

export async function listMarkdownLevel(
  scope: GitScope<FolderListingClient>,
  repo: ListedRepo,
  scopePath: string,
  options: ListLevelOptions = {},
): Promise<FolderListing> {
  if (
    !repo.defaultBranch &&
    (options.atCommitId === undefined || options.atCommitId === "")
  ) {
    return { files: [], folders: [] };
  }

  const read: LevelRead = {
    gitClient: scope.git(),
    projectId: scope.projectId,
    repo,
    scopePath,
    versionDescriptor: levelVersion(repo, options.atCommitId),
  };

  const items = await fetchLevelItems(read, options);
  if (!items) return { files: [], folders: [] };

  // ADO returns the scope folder itself as the first item — the pure
  // `projectMarkdownLevel` helper skips it, keeps only `.md` files
  // (case-insensitive), and sorts. See adoGitData.helpers for the invariants.
  const listing = projectMarkdownLevel(items, scopePath);
  // An Azure DevOps wiki folder orders its pages with a `.order` file.
  const orderPath = findOrderFile(items, scopePath);

  if (orderPath !== undefined && orderPath !== "") {
    const order = await readOrderFile(read, orderPath);
    if (order !== undefined) listing.order = order;
  }

  return listing;
}

/**
 * Pin reads to the default branch's tip so repos with no default
 * branch ref selection still return a coherent listing — or to a commit
 * (a pull request's source) when one is given. Numeric literals mirror the
 * SDK enums (`GitVersionType` Branch=0 / Commit=2, `GitVersionOptions.None`).
 */
function levelVersion(
  repo: ListedRepo,
  atCommitId: string | undefined,
): GitVersionDescriptor {
  return atCommitId !== undefined && atCommitId !== ""
    ? {
        version: atCommitId,
        versionType: 2 /* GitVersionType.Commit */,
        versionOptions: 0 /* GitVersionOptions.None */,
      }
    : {
        version: stripRefsHeads(repo.defaultBranch!),
        versionType: 0 /* GitVersionType.Branch */,
        versionOptions: 0 /* GitVersionOptions.None */,
      };
}

/**
 * The folder's immediate items, or `null` when a failed read should list as
 * empty (see `listingFailureOutcome`); rethrows when the caller propagates.
 */
async function fetchLevelItems(
  read: LevelRead,
  options: ListLevelOptions,
): Promise<GitItem[] | null> {
  const { gitClient, projectId, repo, scopePath, versionDescriptor } = read;

  try {
    return await withRetry(
      () =>
        gitClient.getItems(
          repo.id,
          projectId,
          scopePath,
          1 /* VersionControlRecursionType.OneLevel */,
          false,
          false,
          false,
          false,
          versionDescriptor,
        ),
      { mode: "read", label: "listMarkdownLevel.getItems" },
    );
  } catch (err) {
    const outcome = listingFailureOutcome(err, options);
    if (outcome === "empty") return null;
    if (outcome === "throw") throw err;
    console.warn(
      `[documents-hub] getItems(OneLevel) failed for ${repo.name} @ ${scopePath}:`,
      err,
    );
    trackUserFacingError({
      error: err,
      source: "DocumentsHubApp.repository",
      operation: "folder-listing-load",
      impact: "degraded",
    });

    return null;
  }
}

/** The page names a wiki `.order` file lists, or `undefined` if unreadable. */
async function readOrderFile(
  read: LevelRead,
  orderPath: string,
): Promise<string[] | undefined> {
  const { gitClient, projectId, repo, versionDescriptor } = read;

  try {
    const text = await withRetry(
      () =>
        gitClient.getItemText(
          repo.id,
          orderPath,
          projectId,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          versionDescriptor,
        ),
      { mode: "read", label: "listMarkdownLevel.getItemText(.order)" },
    );

    return parseOrderFile(text);
  } catch (err) {
    // Best-effort: the folder still lists, alphabetically.
    console.warn(
      `[documents-hub] reading ${orderPath} failed for ${repo.name}:`,
      err,
    );

    if (!isItemNotFoundError(err)) {
      trackUserFacingError({
        error: err,
        source: "DocumentsHubApp.repository",
        operation: "wiki-order-load",
        impact: "degraded",
      });
    }

    return undefined;
  }
}
