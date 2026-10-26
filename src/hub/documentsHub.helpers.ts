// Pure helpers extracted from DocumentsHubApp so they can be unit-tested in
// isolation. Nothing here touches the Azure DevOps SDK or React — the SDK
// container resolves the host-specific inputs (extension context, host name)
// and delegates the actual formatting / URL assembly to these functions.

import {
  TARGET_LINK_PARAMS,
  withDeepLinkTarget,
  type DeepLinkTarget,
} from "../shell/deepLink";

/** Compute up-to-two-letter initials for an avatar fallback. */
export function initialsOf(name: string): string {
  // `split(/\s+/)` always yields at least one element (even for ""), so we
  // never need an empty-array guard here.
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Render an unknown thrown value into a human-readable error string. */
export function formatError(err: unknown): string {
  if (err instanceof Error) return err.stack || err.message;
  if (typeof err === "object" && err !== null)
    return JSON.stringify(err, null, 2);
  return String(err);
}

/** Resolved publisher/extension identity from `SDK.getExtensionContext()`. */
export interface ExtensionIdentity {
  publisherId: string;
  extensionId: string;
}

/**
 * Absolute Documents-hub URL that opens `path` in `repoId`, e.g.
 * `<org>/<project>/_apps/hub/<publisher>.<extension>.documents-hub?repo=…&path=…`.
 * Used both for shareable comment deep links and to route a relative Markdown
 * link that points outside the current PR into the hub. Returns `undefined`
 * when the org/project can't be resolved or the base URL is malformed.
 */
export function buildHubDocUrl(
  orgUrl: string,
  projectName: string,
  ext: ExtensionIdentity,
  repoId: string,
  path: string,
): string | undefined {
  if (!orgUrl || !projectName) return undefined;
  const base = `${orgUrl.replace(/\/+$/, "")}/${encodeURIComponent(
    projectName,
  )}/_apps/hub/${ext.publisherId}.${ext.extensionId}.documents-hub`;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return undefined;
  }
  // Carry the repo id so a link to a doc in a non-default repo selects the
  // right repo on load (the hub otherwise defaults to the first repo, which
  // would resolve the path/thread against the wrong repository).
  if (repoId) url.searchParams.set("repo", repoId);
  const cleanPath = path.replace(/^\/+/, "");
  if (cleanPath) url.searchParams.set("path", cleanPath);
  return url.toString();
}

/**
 * The {@link buildHubDocUrl} target with a `?comment=<threadId>` or
 * `?anchor=<slug>` param added — the shareable deep link behind "Link to
 * comment" and the heading link button. Returns `undefined` (→ the link
 * reports a copy failure) when the base URL can't build.
 */
export function assembleHubDeepLinkUrl(
  orgUrl: string,
  projectName: string,
  ext: ExtensionIdentity,
  repoId: string,
  path: string,
  target: DeepLinkTarget,
): string | undefined {
  const url = buildHubDocUrl(orgUrl, projectName, ext, repoId, path);
  if (!url) return undefined;
  return withDeepLinkTarget(url, target);
}

/**
 * Route-param updates for opening `path` in `repoId`: pins the repo and the
 * slash-free path (`?path=docs/x.md`, matching ADO's native Files URLs — the
 * host encodes `/` as %2F). Moving to a *different* document (another path,
 * or the same path in another repo) also drops the `?anchor=` heading,
 * `?text=` quote and `?comment=` thread, which belonged to the previous one — a linked comment
 * that never activated (deleted, or still loading) would otherwise ride along
 * with the new path. Re-publishing the same document (the hub does so on
 * load) keeps a deep link intact.
 */
export function routeUpdatesForPath(
  current: Record<string, string | undefined>,
  repoId: string,
  path: string,
): Record<string, string> {
  const bare = path.replace(/^\/+/, "");
  const updates: Record<string, string> = { repo: repoId, path: bare };
  const currentPath = (current.path ?? "").replace(/^\/+/, "");
  // A link without `?repo=` names the hub's default repo, so only a different
  // explicit repo counts as a move.
  const otherRepo = !!current.repo && current.repo !== repoId;
  if (otherRepo || currentPath !== bare) {
    for (const param of TARGET_LINK_PARAMS) updates[param] = "";
  }
  return updates;
}

/**
 * Derive the org's web URL (no trailing slash) from the iframe `document.referrer`.
 * The first path segment of an ADO URL is the org/collection name. Returns `""`
 * when the referrer is empty or unparseable, leaving mentions non-navigable
 * rather than pointing wrong.
 */
export function orgUrlFromReferrer(referrer: string): string {
  try {
    if (referrer) {
      const u = new URL(referrer);
      const segments = u.pathname.split("/").filter(Boolean);
      if (segments.length > 0) return `${u.origin}/${segments[0]}`;
      return u.origin;
    }
  } catch {
    // Falls through to the empty default.
  }
  return "";
}
