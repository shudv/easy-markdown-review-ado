// Pure helpers extracted from DocumentsHubApp so they can be unit-tested in
// isolation. Nothing here touches the Azure DevOps SDK or React — the SDK
// container resolves the host-specific inputs (extension context, host name)
// and delegates the actual formatting / URL assembly to these functions.

import { withCommentParam } from "../comments/commentLink";

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
 * The {@link buildHubDocUrl} target with a `?comment=<threadId>` param added,
 * for the "Link to comment" shareable deep link. Returns `undefined` (→ the
 * caller falls back to the in-iframe hash link) when the base URL can't build.
 */
export function assembleHubCommentUrl(
  orgUrl: string,
  projectName: string,
  ext: ExtensionIdentity,
  repoId: string,
  path: string,
  threadId: string,
): string | undefined {
  const url = buildHubDocUrl(orgUrl, projectName, ext, repoId, path);
  if (!url) return undefined;
  return withCommentParam(url, threadId);
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
