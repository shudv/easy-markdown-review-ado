// First-render discovery for the Documents hub: resolve the project, page in
// the first repos, pick the repo/document to open (deep link > last visited >
// first repo) and seed the picker view.

import type {
  GitPullRequest,
  GitRepository,
} from "azure-devops-extension-api/Git";

import type { DocRepo } from "../shell/types";
import { resolveCurrentProject } from "../shell/adoClients";
import {
  fetchRepoById,
  fetchRepoPage,
  type RepoPage,
} from "../shell/adoGitData";
import {
  readAnchorParam,
  readCommentParam,
  readTextParam,
} from "../shell/deepLink";
import { setTelemetryContext } from "../telemetry";
import {
  readLastPath,
  readLastRepo,
  writeLastPath,
  writeLastRepo,
} from "./lastVisited";
import { readRouteParams } from "./hubNavigation";

export type RepoDetailsLoadState = "idle" | "loading" | "loaded" | "error";

export interface DiscoveryState {
  projectId: string;
  projectName: string;
  repos: DocRepo[];
  /** Repo to select on first render (the first repo with markdown). */
  initialRepoId: string;
  /**
   * Document to open on first render, from the `?path=` deep-link route.
   * Applies to the initial repo; undefined when no route was present.
   */
  initialSelectedPath?: string;
  /**
   * Thread to auto-open on first render, from the `?comment=` deep-link route.
   * Forwarded to DocumentsApp alongside `initialSelectedPath`.
   */
  initialActiveThreadId?: string;
  /** Heading to scroll to on first render, from the `?anchor=` route. */
  initialAnchor?: string;
  /** Serialized text fragment to flash in the initially opened document (`?text=`). */
  initialTextFragment?: string;
  /** Resolved per-repo PR routing — populated lazily by `loadDetailsFor`. */
  prByRepo: Record<string, GitPullRequest | undefined>;
  /** Raw `GitRepository` payloads we need to feed `loadRepoPrRouting`. */
  rawRepoById: Map<string, GitRepository>;
}

/** Picker pagination/filter view state (see the `picker` useState comment). */
export interface PickerState {
  /** Ordered repo ids currently displayed in the dropdown. */
  viewIds: string[];
  /** Active server-side name filter (empty = unfiltered). */
  filter: string;
  /** Continuation token for the current view; `null` when fully paged. */
  token: string | null;
  /** Whether another page can be fetched for the current view. */
  hasMore: boolean;
  /** A page (or filter) fetch is in flight. */
  loading: boolean;
}

/** Repos fetched per page as the user scrolls the picker. */
export const REPO_PAGE_SIZE = 50;

/** Accumulated union of every repo fetched so far, keyed for dedupe. */
interface RepoUnion {
  repos: DocRepo[];
  rawRepoById: Map<string, GitRepository>;
}

/**
 * Resolve which repo opens first: a deep link wins, else the last-visited repo
 * for this project, else the first repo on page one. The first two may live
 * beyond page one, so fetch them by id and fold them into the union (and to
 * the front of the view) when missing.
 */
async function resolveInitialRepoId(
  projectId: string,
  preferredId: string | undefined,
  firstPage: RepoPage,
  union: RepoUnion,
): Promise<string> {
  let resolvedRepoId = firstPage.repos[0]?.id ?? "";
  // May come from the last-visited localStorage cache, which can hold `null`.
  if (preferredId != null && preferredId !== "") {
    if (union.repos.some((r) => r.id === preferredId)) {
      resolvedRepoId = preferredId;
    } else {
      const fetched = await fetchRepoById(projectId, preferredId);
      if (fetched) {
        union.repos.unshift(fetched.repo);
        union.rawRepoById.set(fetched.repo.id, fetched.raw);
        resolvedRepoId = fetched.repo.id;
      }
    }
  }
  return resolvedRepoId;
}

type InitialRoute = Pick<
  DiscoveryState,
  | "initialSelectedPath"
  | "initialActiveThreadId"
  | "initialAnchor"
  | "initialTextFragment"
>;

/** Deep-link seeds for the initial repo, falling back to its last-visited doc. */
function resolveInitialRoute(
  projectId: string,
  resolvedRepoId: string,
  routeParams: Record<string, string>,
): InitialRoute {
  const routedPath = routeParams.path;
  // The route stores a slash-free path (`docs/x.md`) to match ADO's
  // Files URLs; downstream code expects the repo-rooted form. A deep link
  // wins; otherwise reopen the repo's last-visited document, if any.
  const initialSelectedPath = routedPath
    ? `/${routedPath.replace(/^\/+/, "")}`
    : readLastPath(projectId, resolvedRepoId);
  const initialActiveThreadId = readCommentParam(routeParams);
  const initialAnchor = readAnchorParam(routeParams);
  const initialTextFragment = readTextParam(routeParams);
  return {
    initialSelectedPath,
    initialActiveThreadId,
    // A heading only means something in the document the link named;
    // without `?path=` the hub reopens the last-visited doc instead.
    initialAnchor: routedPath ? initialAnchor : undefined,
    initialTextFragment: routedPath ? initialTextFragment : undefined,
  };
}

/**
 * Discover everything the hub needs for its first render. `log` receives
 * progress steps for the console trail.
 */
export async function discoverHub(
  log: (step: string) => void,
): Promise<{ discovery: DiscoveryState; picker: PickerState }> {
  const project = await resolveCurrentProject();
  log(`project: ${project.name}`);

  // De-identified telemetry context: project GUID only, never the name.
  setTelemetryContext({ projectId: project.id });

  // A third-party hub is never handed the repo the user had selected in
  // Repos, so we page in the project's repos and let the in-hub picker
  // choose. The first page (plus the user + route params) is all we need
  // to render; the rest stream in as the user scrolls or filters.
  log("fetching first repo page + route params");
  const [firstPage, routeParams] = await Promise.all([
    fetchRepoPage(project.id, { top: REPO_PAGE_SIZE }),
    readRouteParams(),
  ]);
  log(`first page: ${firstPage.repos.length} repo(s)`);

  const union: RepoUnion = {
    repos: [...firstPage.repos],
    rawRepoById: new Map(firstPage.rawRepoById),
  };
  const routedRepoId = routeParams.repo;
  const lastRepoId = readLastRepo(project.id);
  const resolvedRepoId = await resolveInitialRepoId(
    project.id,
    routedRepoId || lastRepoId,
    firstPage,
    union,
  );
  const route = resolveInitialRoute(project.id, resolvedRepoId, routeParams);

  // Seed the cache from wherever we landed so a later root-URL visit
  // restores it. Without this, a deep link (`?repo=…&path=…`) never
  // updates the cache — the initial repo/path don't flow through the
  // `onSelectRepo`/`onSelectPath` callbacks (those only fire on later
  // user-driven changes), so returning to `/` would fall back to the
  // first repo + default document instead of where the user last was.
  writeLastRepo(project.id, resolvedRepoId);
  if (route.initialSelectedPath != null && route.initialSelectedPath !== "") {
    writeLastPath(project.id, resolvedRepoId, route.initialSelectedPath);
  }

  return {
    discovery: {
      projectId: project.id,
      projectName: project.name,
      repos: union.repos,
      prByRepo: {},
      rawRepoById: union.rawRepoById,
      initialRepoId: resolvedRepoId,
      ...route,
    },
    picker: {
      viewIds: union.repos.map((r) => r.id),
      filter: "",
      token: firstPage.continuationToken,
      hasMore: firstPage.continuationToken !== null,
      loading: false,
    },
  };
}
