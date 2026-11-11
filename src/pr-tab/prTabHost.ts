// SDK host-navigation glue for the PR tab: the extension identity for share
// links, the route's deep-link targets, and opening doc links in a new tab.

import * as SDK from "azure-devops-extension-sdk";
import { CommonServiceIds, type IHostNavigationService } from "azure-devops-extension-api";

import type { DocLinkNavigation } from "../shell/Shell";
import { withDeepLinkTarget } from "../shell/deepLink";
import { buildReposFileUrl } from "../markdown/docLinks";
import { buildHubDocUrl } from "../hub/documentsHub.helpers";
import {
    events,
    markBootPhase,
    noteBootCache,
    noteBootShape,
    setTelemetryContext,
    track,
    trackUserFacingError,
} from "../telemetry";
import { prBranchVersion, type PrContext } from "./prContext.helpers";

/**
 * The extension's publisher/extension ids (for the `_a` tab selector), or
 * `undefined` when the SDK context isn't available.
 */
export function readExtensionIdentity(): { publisherId: string; extensionId: string } | undefined {
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
export async function openDocTarget(ctx: PrContext, target: DocLinkNavigation): Promise<void> {
    if (target.kind === "repo-file") {
        await openInNewTab(
            buildReposFileUrl(
                {
                    orgUrl: ctx.orgUrl,
                    project: ctx.projectName,
                    repoName: ctx.repositoryName,
                },
                target.path,
                prBranchVersion(ctx.pr),
            ),
        );

        return;
    }

    let url = hubUrlFor(ctx, target.path);

    // Carry a `#heading` from the link so the hub opens scrolled to it.
    if (url !== undefined && url !== "" && target.hash) {
        url =
            withDeepLinkTarget(url, {
                kind: "heading",
                anchor: target.hash,
            }) ?? url;
    }

    await openInNewTab(url);
}

/**
 * Open this repository's documents in the Documents hub, in a new tab: the
 * PR tab's way into every other Markdown file in the repo. `from` says which
 * entry point the reader used.
 */
export async function openRepositoryDocuments(
    ctx: PrContext,
    from: "nav" | "empty-pr",
): Promise<void> {
    const url = hubUrlFor(ctx, "");
    if (url === undefined) return;
    track(events.documentsHubOpened({ from }));
    await openInNewTab(url);
}

/** The Documents-hub URL for `path` in this PR's repository, or `undefined`. */
function hubUrlFor(ctx: PrContext, path: string): string | undefined {
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

        return undefined;
    }

    return buildHubDocUrl(
        {
            orgUrl: ctx.orgUrl,
            projectName: ctx.projectName,
            repoId: ctx.repositoryId,
            path,
        },
        ext,
    );
}

/** Open `url` in a new browser tab via the host. Best-effort. */
async function openInNewTab(url: string | undefined): Promise<void> {
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
 * The host's query params the PR tab opened with — its deep-link targets
 * (`?path=`, `?comment=`, `?anchor=`, …). Read once per boot. Best-effort: an unavailable navigation service yields
 * none (the tab opens normally).
 */
export async function readBootRoute(): Promise<Record<string, string>> {
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

    return params;
}

/**
 * Merge `updates` into the host page's query string (an empty value removes a
 * param), so the address bar mirrors the open file + active comment or heading
 * and is itself a shareable link. Best-effort: a missing navigation service is
 * silently ignored.
 */
export async function writeRouteParams(updates: Record<string, string>): Promise<void> {
    try {
        const nav = await SDK.getService<IHostNavigationService>(
            CommonServiceIds.HostNavigationService,
        );

        nav.setQueryParams(updates);
    } catch {
        /* navigation service unavailable — route syncing is best-effort */
    }
}

/**
 * Record that the tab shows the PR (as cached in this browser, or as just
 * loaded): the boot phase, its shape, and — ids only, the PR id hashed — the
 * telemetry context for everything after.
 */
export function notePrShown(
    ctx: PrContext,
    cached: boolean,
    log: (step: string, extra?: unknown) => void,
): void {
    markBootPhase("context-ready");
    noteBootShape({ mdFileCount: ctx.changedMdFiles.length });
    noteBootCache("pr", cached);

    const ids = {
        projectId: ctx.projectId,
        repositoryId: ctx.repositoryId,
        pullRequestId: ctx.pullRequestId,
    };

    log("pr context resolved", { ...ids, fileCount: ctx.changedMdFiles.length, cached });
    setTelemetryContext(ids);
}
