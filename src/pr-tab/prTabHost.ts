// SDK host-navigation glue for the PR tab: the extension identity for share
// links, the route's deep-link targets, and opening doc links in a new tab.

import * as SDK from "azure-devops-extension-sdk";
import {
  CommonServiceIds,
  type IHostNavigationService,
} from "azure-devops-extension-api";

import type { DocLinkNavigation } from "../shell/Shell";
import type { HistoryStop } from "../shell/shellHelpers";
import { withDeepLinkTarget } from "../shell/deepLink";
import { buildReposFileUrl } from "../markdown/docLinks";
import { buildHubDocUrl } from "../hub/documentsHub.helpers";
import { trackUserFacingError } from "../telemetry";
import type { FileInfo } from "../types";
import { resolvePrTabRouteSeed, type PrTabRouteSeed } from "./prTabApp.helpers";
import { prBranchVersion, type PrContext } from "./prContext.helpers";

/**
 * The extension's publisher/extension ids (for the `_a` tab selector), or
 * `undefined` when the SDK context isn't available.
 */
export function readExtensionIdentity():
  | { publisherId: string; extensionId: string }
  | undefined {
  try {
    return SDK.getExtensionContext();
  } catch {
    return undefined;
  }
}

/**
 * Open a doc-link target that leaves the current PR view, in a new browser tab.
 * A markdown file that lives outside this PR opens in the Documents hub;
 * anything else (non-markdown, or a file not part of the PR) opens in the ADO
 * Files explorer at the PR's source branch. Best-effort — a missing navigation
 * service, extension context, or unresolvable URL is silently ignored (the
 * click just no-ops).
 */
export async function openDocTarget(
  ctx: PrContext,
  target: DocLinkNavigation,
): Promise<void> {
  let url: string | undefined;
  if (target.kind === "repo-file") {
    url = buildReposFileUrl(
      {
        orgUrl: ctx.orgUrl,
        project: ctx.projectName,
        repoName: ctx.repositoryName,
      },
      target.path,
      prBranchVersion(ctx.pr),
    );
  } else {
    let ext: { publisherId: string; extensionId: string };
    try {
      ext = SDK.getExtensionContext();
    } catch (err) {
      trackUserFacingError({
        error: err,
        source: "PrTabApp.navigation",
        operation: "document-link-open",
        impact: "action-failed",
      });
      return;
    }
    url = buildHubDocUrl(
      {
        orgUrl: ctx.orgUrl,
        projectName: ctx.projectName,
        repoId: ctx.repositoryId,
        path: target.path,
      },
      ext,
    );
    // Carry a `#heading` from the link so the hub opens scrolled to it.
    if (url !== undefined && url !== "" && target.hash) {
      url =
        withDeepLinkTarget(url, { kind: "heading", anchor: target.hash }) ??
        url;
    }
  }
  if (url === undefined || url === "") return;
  try {
    const nav = await SDK.getService<IHostNavigationService>(
      CommonServiceIds.HostNavigationService,
    );
    nav.openNewWindow(url, "");
  } catch (err) {
    // Best-effort: the doc just doesn't open. Surface the failure for
    // diagnostics (matching the console.warn pattern in the ADO data layer)
    // rather than swallowing it silently.
    console.warn("[pr-tab] opening doc link failed:", err);
    trackUserFacingError({
      error: err,
      source: "PrTabApp.navigation",
      operation: "document-link-open",
      impact: "action-failed",
    });
  }
}

/**
 * Read the PR tab's deep-link targets (`?path=`, `?comment=`, `?anchor=`) from
 * the host's query params. Best-effort: an unavailable navigation service
 * yields no targets (the tab opens normally).
 */
export async function readRouteSeed(
  files: readonly FileInfo[],
  stops: readonly HistoryStop[],
): Promise<PrTabRouteSeed> {
  let params: Record<string, string> = {};
  try {
    const nav = await SDK.getService<IHostNavigationService>(
      CommonServiceIds.HostNavigationService,
    );
    // Typed non-null by the SDK, but the host can resolve nothing.
    const routeParams = (await nav.getQueryParams()) as
      | Record<string, string>
      | null
      | undefined;
    params = routeParams ?? {};
  } catch {
    /* navigation service unavailable — open without deep-link targets */
  }
  return resolvePrTabRouteSeed(params, files, stops);
}

/**
 * Merge `updates` into the host page's query string (an empty value removes a
 * param), so the address bar mirrors the open file + active comment or heading
 * and is itself a shareable link. Best-effort: a missing navigation service is
 * silently ignored.
 */
export async function writeRouteParams(
  updates: Record<string, string>,
): Promise<void> {
  try {
    const nav = await SDK.getService<IHostNavigationService>(
      CommonServiceIds.HostNavigationService,
    );
    nav.setQueryParams(updates);
  } catch {
    /* navigation service unavailable — route syncing is best-effort */
  }
}
