// Host (azure-devops-extension-sdk) glue for the Documents hub: route query
// params, new-tab navigation, deep-link URLs, the org URL and the signed-in
// user. Every call is best-effort so a missing host service degrades quietly.

import * as SDK from "azure-devops-extension-sdk";
import {
  CommonServiceIds,
  type IHostNavigationService,
} from "azure-devops-extension-api";

import type { CommentAuthor } from "../types";
import { identityAvatarUrl } from "../shell/adoGitData.helpers";
import type { DeepLinkTarget } from "../shell/deepLink";
import {
  assembleHubDeepLinkUrl,
  initialsOf,
  orgUrlFromReferrer,
  type HubDocLocation,
} from "./documentsHub.helpers";

/**
 * Read the hub's current query parameters (e.g. the `?path=` deep-link).
 * Best-effort: returns `{}` when the navigation service is unavailable.
 */
export async function readRouteParams(): Promise<Record<string, string>> {
  try {
    const nav = await SDK.getService<IHostNavigationService>(
      CommonServiceIds.HostNavigationService,
    );
    return (await nav.getQueryParams()) ?? {};
  } catch {
    return {};
  }
}

/**
 * Open `url` in a new browser tab via the host navigation service, used to
 * route a non-Markdown relative link to ADO's native Files view. Best-effort:
 * a missing navigation service is silently ignored (the click just no-ops).
 */
export async function openInNewTab(url: string): Promise<void> {
  try {
    const nav = await SDK.getService<IHostNavigationService>(
      CommonServiceIds.HostNavigationService,
    );
    nav.openNewWindow(url, "");
  } catch {
    /* navigation service unavailable — opening the file is best-effort */
  }
}

/**
 * Apply `updates` to the hub's query string without reloading the page, so
 * in-hub navigation is reflected in (and shareable via) the URL. `updates` may
 * be derived from the current params. Only the delta is sent: the host's
 * `setQueryParams` merges (add / update / remove-on-empty), and resending a
 * full snapshot would let one of two overlapping writes (e.g. a document
 * switch and the comment it deselects) restore the other's stale values.
 * Best-effort when the navigation service is missing.
 */
export async function setRouteQuery(
  updates:
    | Record<string, string>
    | ((current: Record<string, string>) => Record<string, string>),
): Promise<void> {
  try {
    const nav = await SDK.getService<IHostNavigationService>(
      CommonServiceIds.HostNavigationService,
    );
    const next =
      typeof updates === "function"
        ? updates((await nav.getQueryParams()) ?? {})
        : updates;
    nav.setQueryParams(next);
  } catch {
    /* navigation service unavailable — route syncing is best-effort */
  }
}

/**
 * Build the absolute, shareable Documents-hub URL for a deep link to a thread
 * or heading. Resolves the extension identity from the SDK, then delegates the
 * URL assembly to the pure `assembleHubDeepLinkUrl`. Returns `undefined` when
 * the extension context can't be resolved (the copy then reports a failure).
 */
export function buildHubDeepLinkUrl(
  doc: HubDocLocation,
  target: DeepLinkTarget,
): string | undefined {
  let ext: { publisherId: string; extensionId: string };
  try {
    ext = SDK.getExtensionContext();
  } catch {
    return undefined;
  }
  return assembleHubDeepLinkUrl(doc, ext, target);
}

/**
 * Resolve the org's web URL (no trailing slash) for hydrating mention links.
 * Mirrors the helper in `pr-tab/PrTabApp.tsx`. Returns `""` when nothing is
 * resolvable, leaving mentions non-navigable rather than pointing wrong.
 */
export function resolveOrgUrl(): string {
  try {
    const host = SDK.getHost();
    if (host?.name) return `https://dev.azure.com/${host.name}`;
  } catch {
    // Falls through to the referrer-based heuristic.
  }
  return orgUrlFromReferrer(document.referrer);
}

/** The signed-in user as a comment author. */
export function readCurrentUser(): CommentAuthor {
  const u = SDK.getUser();
  return {
    id: u.id,
    displayName: u.displayName,
    initials: initialsOf(u.displayName),
    avatarUrl: identityAvatarUrl(u),
  };
}
