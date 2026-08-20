// Comment-permission probe — pure helpers.
//
// The transparent comment-housing feature needs to push a branch, commit a
// marker, and open a draft PR, so a user can only comment when they hold
// "Contribute" on the repository. This module owns the branch-free math: the
// security token, the REST path, and the (deliberately optimistic) verdict
// parser. The SDK-touching fetch lives in `commentPermission.ts`.

/** Git Repositories security namespace id (stable ADO GUID). */
export const GIT_REPOSITORIES_NAMESPACE_ID =
  "2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87";

/**
 * "Contribute" permission bit for the Git Repositories namespace — push
 * commits, create branches, and open pull requests. The transparent comment
 * housing PR needs all three, so this single bit is our proxy for "can the
 * current user comment on this repository".
 */
export const GIT_CONTRIBUTE_BIT = 4;

/** Security token addressing a single repository (`repoV2/{project}/{repo}`). */
export function repoSecurityToken(projectId: string, repoId: string): string {
  return `repoV2/${projectId}/${repoId}`;
}

/**
 * Whether `orgUrl` is a trusted Azure DevOps collection origin. The probe
 * attaches the caller's ADO access token to this URL, so we must never send it
 * to a non-ADO host. Accepts only `https://dev.azure.com/...` and the legacy
 * `https://<org>.visualstudio.com/...` form.
 */
export function isAzureDevOpsOrgUrl(orgUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(orgUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return host === "dev.azure.com" || host.endsWith(".visualstudio.com");
}

/** Relative path for the ADO "Permissions - Has Permissions" REST call. */
export function hasPermissionsPath(
  namespaceId: string,
  bit: number,
  token: string,
): string {
  return `_apis/permissions/${namespaceId}/${bit}?tokens=${encodeURIComponent(
    token,
  )}&api-version=7.1`;
}

export interface CommentPermission {
  /** `false` only when ADO explicitly denied; `true` when allowed or unknown. */
  canComment: boolean;
  /** Whether the verdict came from a definitive ADO response. */
  resolved: boolean;
}

/**
 * Interpret the ADO Has-Permissions response body. Deliberately optimistic:
 * only an explicit, fully-`false` result denies. A missing / empty / malformed
 * body leaves commenting enabled so a flaky or unsupported probe never wrongly
 * locks out a real contributor.
 */
export function commentPermissionFromResponse(
  body: { value?: unknown } | null | undefined,
): CommentPermission {
  const value = body?.value;
  if (Array.isArray(value) && value.length > 0) {
    return { canComment: value.every((v) => v === true), resolved: true };
  }
  return { canComment: true, resolved: false };
}

/** Message shown in the rail (right panel) when commenting is permission-gated. */
export const COMMENT_PERMISSION_DENIED_MESSAGE =
  "You don't have permission to comment on this repository. Commenting " +
  "requires Contribute access.";
