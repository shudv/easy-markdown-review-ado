// Full-page hub: "Documents" inside our own top-level "Markdown Review" hub
// group (parallel to Azure Repos), NOT under the Repos code-hub group. Because
// it's a third-party hub, ADO never passes it the selected repository through
// any channel (proven empirically), so it owns its own in-hub repo selector
// instead of trying to read one from the page route.
//
// This is the genuinely large reading surface. A side panel/dialog is capped
// by the host at PanelSize.Large (~640px); a hub fills the project content
// area and — by entering full-screen mode on load — collapses ADO's L1/L2 nav
// so the rendered Markdown + comment rail span the whole viewport.
//
// Reachable two ways, so it handles two entry states:
//   1. A bookmarked / shared deep-link URL that encodes a target file as query
//      params → render that file (Reader state), full-screen so a single
//      document spans the viewport.
//   2. Direct click on the left-nav entry / a bare URL with no params →
//      the Documents browser (<DocumentsHubApp/>): it lists every repo in the
//      project and shows the active repo's markdown inventory with the file
//      view + comments, switchable via the in-hub repo selector.
// Missing/!accessible params surface through <MarkdownReader/>'s own error UI.

import "../shell/styles.scss";
import "./markdownReviewHub.scss";

import * as React from "react";
import * as SDK from "azure-devops-extension-sdk";
import { createRoot } from "react-dom/client";
import {
  CommonServiceIds,
  type IHostNavigationService,
  type IHostPageLayoutService,
} from "azure-devops-extension-api";
import { MarkdownReader, type ReaderConfig } from "./markdownReader";
import { DocumentsHubApp } from "./DocumentsHubApp";
import { parseHubQuery } from "../shell/hubQuery";
import { orchestrateBoot } from "../shell/boot";
import { syncHostTheme } from "../theme/theme";
import {
  ErrorBoundary,
  initTelemetry,
  installGlobalErrorHandlers,
  installAuthFailureCapture,
  markAppReady,
  markBootPhase,
  markBootStart,
  setTelemetryContext,
  trackUserFacingError,
} from "../telemetry";

function basename(path: string): string {
  const clean = path.replace(/\/+$/, "");
  const idx = clean.lastIndexOf("/");
  return idx >= 0 ? clean.slice(idx + 1) : clean;
}

/** Reader state: a file was passed via query params. */
function HubReader({
  config,
  onBack,
}: {
  config: ReaderConfig;
  onBack: () => void;
}): React.ReactElement {
  return (
    <div className="emr-hub__reader">
      <div className="emr-hub__bar">
        <button type="button" className="emr-hub__back" onClick={onBack}>
          ← Back to Files
        </button>
        <span className="emr-hub__path" title={config.path}>
          {basename(config.path)}
        </span>
      </div>
      <div className="emr-hub__content">
        <MarkdownReader config={config} />
      </div>
    </div>
  );
}

function HubApp({
  config,
  filesUrl,
  navService,
}: {
  config: ReaderConfig | null;
  filesUrl: string | null;
  navService: IHostNavigationService;
}): React.ReactElement {
  const onBack = React.useCallback(() => {
    if (filesUrl) navService.navigate(filesUrl);
    else navService.reload();
  }, [filesUrl, navService]);

  // Direct navigation (no file passed): show the Documents browser. It lists
  // every repo in the project and renders the selected repo's file view +
  // reader + comments, with an in-hub repo selector — the experience the
  // standalone Documents hub used to provide.
  if (!config) return <DocumentsHubApp />;
  return <HubReader config={config} onBack={onBack} />;
}

/**
 * Host-relative Azure Repos Files URL for the target, used by the in-hub
 * "Back to Files" affordance. Needs the repo *name* (the `_git/` route rejects
 * a GUID), so it's only built when the menu action passed `repositoryName`.
 */
function buildFilesUrl(org: string, config: ReaderConfig): string | null {
  if (!config.repositoryName) return null;
  const params = new URLSearchParams({ path: config.path });
  return `/${encodeURIComponent(org)}/${encodeURIComponent(
    config.project,
  )}/_git/${encodeURIComponent(config.repositoryName)}?${params.toString()}`;
}

/**
 * The installed extension version as reported by the host
 * (`SDK.getExtensionContext().version`), or undefined if unavailable.
 * Best-effort — telemetry must never break boot, so any failure is swallowed.
 */
function installedExtensionVersion(): string | undefined {
  try {
    return SDK.getExtensionContext().version;
  } catch {
    return undefined;
  }
}

async function boot(): Promise<void> {
  // Start the boot-time clock before the SDK handshake so the measurement spans
  // the whole path to first rendered Markdown, not just React startup.
  // `markAppReady()` fires later — from PrShell when the first document renders,
  // or from HubApp for the empty landing state.
  markBootStart();
  initTelemetry({ appName: "documents-hub" });
  installGlobalErrorHandlers();
  installAuthFailureCapture();
  await orchestrateBoot({
    init: () => SDK.init({ loaded: false, applyTheme: true }),
    ready: async () => {
      await SDK.ready();
      markBootPhase("sdk-ready");
      setTelemetryContext({ extensionVersion: installedExtensionVersion() });
    },
    run: async () => {
      syncHostTheme();

      const navService = await SDK.getService<IHostNavigationService>(
        CommonServiceIds.HostNavigationService,
      );
      const params = await navService.getQueryParams();
      const config = parseHubQuery(params);
      markBootPhase("context-ready");

      // Only collapse the nav for the actual reader; the empty/landing state is
      // a normal hub page so the user can still navigate away.
      if (config) {
        const layoutService = await SDK.getService<IHostPageLayoutService>(
          CommonServiceIds.HostPageLayoutService,
        );
        layoutService.setFullScreenMode(true);
      }

      const filesUrl = config
        ? buildFilesUrl(SDK.getHost().name, config)
        : null;

      const rootEl = document.getElementById("root");
      if (!rootEl) throw new Error("Root element not found");
      createRoot(rootEl).render(
        <ErrorBoundary source="documents-hub">
          <HubApp config={config} filesUrl={filesUrl} navService={navService} />
        </ErrorBoundary>,
      );
    },
    notifySucceeded: () => SDK.notifyLoadSucceeded(),
    notifyFailed: (err) => SDK.notifyLoadFailed(err),
    onError: (err) => {
      console.error("[MarkdownReviewHub] startup failed", err);
      trackUserFacingError({
        error: err,
        source: "documents-hub.boot",
        operation: "boot",
        impact: "blocking",
        severity: "critical",
      });
      markAppReady("error");
    },
  });
}

void boot();
