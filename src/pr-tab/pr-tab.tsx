// Entry point for the Pull Request tab iframe.
//
// Responsibilities:
//   1. Initialise the Azure DevOps Extension SDK.
//   2. Render the React app.
//   3. Tell the host we're loaded.
//   4. Catch boot failures and show a readable error inside the iframe so we
//      can debug without dev-tools every time.

import "../shell/styles.scss";

import * as SDK from "azure-devops-extension-sdk";
import * as React from "react";
import { createRoot } from "react-dom/client";

import { PrTabApp } from "./PrTabApp";
import { orchestrateBoot } from "../shell/boot";
import { bootErrorDetail, renderBootErrorInto } from "../shell/bootError";
import { syncHostTheme } from "../theme/theme";
import {
  ErrorBoundary,
  initTelemetry,
  installGlobalErrorHandlers,
  installAuthFailureCapture,
  markBootStart,
  trackException,
} from "../telemetry";

// Start the boot-time clock as early as possible so the measurement spans the
// whole path to first rendered Markdown (SDK handshake + fetches + render), not
// just the time to kick off React. `markAppReady()` fires later — from PrShell
// when the first document renders, or from PrTabApp for empty/error states.
markBootStart();

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

void orchestrateBoot({
  // loaded: false means the host frame keeps showing the loading spinner until
  // we call notifyLoadSucceeded() ourselves. This gives us a chance to render
  // before the user sees the tab.
  //
  // applyTheme: true asks the SDK to inject the host's theme CSS variables
  // onto <body>; syncHostTheme() reads --background-color luminance off that
  // and swaps our markdown stylesheet (and chrome palette via cascade) to
  // match. The MutationObserver inside syncHostTheme keeps us in sync if
  // the user toggles their ADO theme without reloading.
  init: () => SDK.init({ loaded: false, applyTheme: true }),
  ready: () => SDK.ready(),
  run: async () => {
    // Telemetry must come up before we render so early errors are captured.
    // Thread the *installed* extension version (SDK-reported, e.g.
    // 0.0.1.<timestamp>) into context so triage can tell a stale deployment
    // apart from the current build.
    initTelemetry({
      appName: "pr-tab",
      extensionVersion: installedExtensionVersion(),
    });
    installGlobalErrorHandlers();
    installAuthFailureCapture();

    syncHostTheme();

    const rootEl = document.getElementById("root");
    if (!rootEl) throw new Error("Root element not found");
    createRoot(rootEl).render(
      <ErrorBoundary source="pr-tab">
        <PrTabApp />
      </ErrorBoundary>,
    );
  },
  notifySucceeded: () => SDK.notifyLoadSucceeded(),
  notifyFailed: (err) => SDK.notifyLoadFailed(err),
  onError: (err) => {
    console.error("Markdown Review tab failed to boot", err);
    trackException({
      error: err,
      severity: "critical",
      source: "pr-tab.boot",
      handled: true,
    });
    const root = document.getElementById("root");
    if (root) renderBootErrorInto(root, bootErrorDetail(err));
  },
});
