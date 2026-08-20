// Comment-permission probe — SDK-touching wrapper.
//
// Calls the ADO "Permissions - Has Permissions" REST endpoint to decide whether
// the current user holds "Contribute" on a repository (the proxy for "can
// comment", since the transparent housing PR needs push + branch + PR-create).
//
// Defensive by design: any failure (no token, network error, unsupported
// endpoint, non-OK status) resolves to an *unresolved, allowed* verdict so a
// broken probe never blocks a legitimate contributor. The pure parsing /
// token / path logic lives in `commentPermission.helpers.ts` (covered).

import * as SDK from "azure-devops-extension-sdk";

import {
  commentPermissionFromResponse,
  GIT_CONTRIBUTE_BIT,
  GIT_REPOSITORIES_NAMESPACE_ID,
  hasPermissionsPath,
  isAzureDevOpsOrgUrl,
  repoSecurityToken,
  type CommentPermission,
} from "./commentPermission.helpers";

const ALLOWED_UNRESOLVED: CommentPermission = {
  canComment: true,
  resolved: false,
};

/**
 * Probe whether the current user may comment on `repoId` within `projectId`.
 * `orgUrl` is the collection web URL (no trailing slash required).
 */
export async function checkRepoCommentPermission(
  orgUrl: string,
  projectId: string,
  repoId: string,
): Promise<CommentPermission> {
  if (!orgUrl) return ALLOWED_UNRESOLVED;
  // Never attach the ADO access token to a non-ADO origin.
  if (!isAzureDevOpsOrgUrl(orgUrl)) return ALLOWED_UNRESOLVED;
  try {
    const accessToken = await SDK.getAccessToken();
    const base = orgUrl.replace(/\/+$/, "");
    const url = `${base}/${hasPermissionsPath(
      GIT_REPOSITORIES_NAMESPACE_ID,
      GIT_CONTRIBUTE_BIT,
      repoSecurityToken(projectId, repoId),
    )}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) return ALLOWED_UNRESOLVED;
    const body = (await res.json()) as { value?: unknown };
    return commentPermissionFromResponse(body);
  } catch {
    // Never block commenting because the probe failed.
    return ALLOWED_UNRESOLVED;
  }
}
