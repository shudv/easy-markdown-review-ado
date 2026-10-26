// Shared Azure DevOps REST clients.
//
// `getClient(X)` from azure-devops-extension-api resolves every new client's
// base URL through two host round-trips (LocationService, then the resource
// area's location), and each request then asks the host for an access token.
// Creating a fresh client per call — as every call site used to — repeated the
// location lookup for every file load, diff, thread fetch, and image. Measured
// on the PR tab, the first REST call took ~700 ms of which only ~170 ms was the
// request itself.
//
// One client per page, created (and its location resolved) as early as
// possible, removes those repeats and takes the first lookup off the critical
// path. A failed lookup is retried by the next request.

import * as SDK from "azure-devops-extension-sdk";
import {
  CommonServiceIds,
  getClient,
  type ILocationService,
  type IProjectPageService,
} from "azure-devops-extension-api";
import { GitRestClient } from "azure-devops-extension-api/Git";
import { WorkItemTrackingRestClient } from "azure-devops-extension-api/WorkItemTracking";

import { webContextProject } from "./adoGitData.helpers";

let git: GitRestClient | null = null;
let workItems: WorkItemTrackingRestClient | null = null;

/**
 * Build a client whose base URL is resolved once, starting now — the same
 * lookup `getClient` would do lazily. The client awaits `rootPath` on every
 * request, so it gets a thenable rather than a promise: a failed lookup is
 * dropped and re-run by the next request instead of failing the client (and
 * every caller holding it) for the rest of the page.
 */
function createClient<T>(clientClass: {
  new (options: object): T;
  RESOURCE_AREA_ID: string;
}): T {
  let lookup: Promise<string> | null = null;
  const resolveRoot = (): Promise<string> =>
    (lookup ??= SDK.getService<ILocationService>(
      CommonServiceIds.LocationService,
    )
      .then((locations) =>
        locations.getResourceAreaLocation(clientClass.RESOURCE_AREA_ID),
      )
      .catch((err: unknown) => {
        lookup = null;
        throw err;
      }));
  resolveRoot().catch(() => undefined);
  const rootPath: PromiseLike<string> = {
    then: (onResolved, onRejected) =>
      resolveRoot().then(onResolved, onRejected),
  };
  return getClient(clientClass, { rootPath: rootPath as Promise<string> });
}

/** The page's Git REST client (base URL resolved once). */
export function sharedGitClient(): GitRestClient {
  return (git ??= createClient(GitRestClient));
}

/** The page's Work Item Tracking REST client (base URL resolved once). */
export function sharedWorkItemClient(): WorkItemTrackingRestClient {
  return (workItems ??= createClient(WorkItemTrackingRestClient));
}

/**
 * Start the Git client's location lookup and the first access-token request
 * right after the SDK handshake, so they overlap with React mounting and the
 * rest of boot instead of stalling the first REST call. Best-effort.
 */
export function warmAdoClients(): void {
  try {
    sharedGitClient();
    void SDK.getAccessToken().catch(() => undefined);
  } catch {
    // Warming is an optimisation; the first real call retries the lookup.
  }
}

/** The SDK's web context, or undefined if the host didn't provide one. */
function readWebContext(): ReturnType<typeof SDK.getWebContext> | undefined {
  try {
    return SDK.getWebContext();
  } catch {
    return undefined;
  }
}

/**
 * The page's project: straight from the SDK's web context when it has one (no
 * host round-trip), otherwise from the ProjectPageService.
 */
export async function resolveCurrentProject(): Promise<{
  id: string;
  name: string;
}> {
  const fromContext = webContextProject(readWebContext());
  if (fromContext) return fromContext;
  const service = await SDK.getService<IProjectPageService>(
    CommonServiceIds.ProjectPageService,
  );
  const project = await service.getProject();
  if (!project) throw new Error("No active project on the page.");
  return { id: project.id, name: project.name };
}
