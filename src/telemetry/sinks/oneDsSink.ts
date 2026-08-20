// 1DS (One Data Strategy) sink — Microsoft's web telemetry collector.
//
// Uses only the two PUBLIC npm packages required for custom-event telemetry:
//   @microsoft/1ds-core-js   → AppInsightsCore (the pipeline)
//   @microsoft/1ds-post-js   → PostChannel (the HTTPS transport to the collector)
//
// We deliberately do NOT use @microsoft/1ds-wa-js / analytics-web-js, the
// auto page-view/click collector — this app emits only explicit, sanitized
// events, so ambient auto-capture is neither needed nor wanted.
//
// The sink is enabled only when a non-empty ingestion key is injected at build
// time (see ../config.ts). With no key, the facade never constructs this sink.

import {
  AppInsightsCore,
  type IExtendedConfiguration,
} from "@microsoft/1ds-core-js";
import {
  PostChannel,
  type IChannelConfiguration,
} from "@microsoft/1ds-post-js";

import type { TelemetryBuildConfig } from "../buildConfig";
import { redactText } from "../sanitize";
import { describeError } from "../errorShape";
import { EVENT } from "../events";
import { toTableEvents } from "../eventTables";
import type {
  TelemetryContext,
  TelemetryEvent,
  TelemetryExceptionInfo,
  TelemetrySink,
} from "../types";

/** Flatten the ambient context into a property bag for a 1DS item. */
function contextData(ctx: TelemetryContext): Record<string, unknown> {
  return {
    appName: ctx.appName,
    appVersion: ctx.appVersion,
    extensionVersion: ctx.extensionVersion,
    environment: ctx.environment,
    projectId: ctx.projectId,
    repositoryId: ctx.repositoryId,
    pullRequestId: ctx.pullRequestId,
    sessionId: ctx.sessionId,
  };
}

/**
 * Build a 1DS-backed sink, or return null if the SDK cannot be initialised so
 * the caller can fall back gracefully. Returning null (rather than throwing)
 * keeps telemetry strictly best-effort.
 */
export function createOneDsSink(
  config: TelemetryBuildConfig,
): TelemetrySink | null {
  let core: AppInsightsCore;
  try {
    core = new AppInsightsCore();
    const channel = new PostChannel();

    const channelConfig: IChannelConfiguration = {
      // Route to a custom collector if one was provided at build time.
      ...(config.endpoint ? { overrideEndpointUrl: config.endpoint } : {}),
    };

    const coreConfig: IExtendedConfiguration = {
      instrumentationKey: config.key,
      channels: [[channel]],
      extensionConfig: {
        [channel.identifier]: channelConfig,
      },
      // Privacy belt-and-braces: the facade already de-identifies payloads, but
      // keep cookies and any ambient PII collection off at the SDK level too.
      disableCookiesUsage: true,
    };

    core.initialize(coreConfig, []);
  } catch {
    return null;
  }

  return {
    name: "1ds",
    init() {
      // Initialisation already happened above; nothing further to do.
    },
    setContext() {
      // Context is attached per-event via contextData(), so no-op here.
    },
    trackEvent(event: TelemetryEvent, ctx: TelemetryContext) {
      try {
        // Context is spread last so a stray event property/measurement can
        // never overwrite an authoritative context field (e.g. sessionId).
        const data = {
          ...event.properties,
          ...event.measurements,
          ...contextData(ctx),
        };
        // Hand off to the telemetry layer's routing; the sink stays oblivious
        // to how many tables this lands in (see ../eventTables.ts).
        for (const item of toTableEvents(event.name, data)) core.track(item);
      } catch {
        /* never throw from telemetry */
      }
    },
    trackException(info: TelemetryExceptionInfo, ctx: TelemetryContext) {
      try {
        const shape = describeError(info.error);
        // Exception text leaks paths/usernames/URLs — scrub before egress.
        const message = redactText(shape.message, 256);
        const stack = redactText(shape.stack, 2048);
        // Custom properties first; the computed exception fields and context
        // are spread after so a property named `message`/`stack`/etc. or a
        // collision with a context key cannot clobber the real value.
        const data = {
          ...info.properties,
          ...contextData(ctx),
          message,
          stack,
          // Structured, privacy-safe failure discriminators (added so a
          // TF400813/401 is diagnosable in the backend without a live repro).
          ...(shape.name ? { errorName: shape.name } : {}),
          ...(shape.httpStatus !== undefined
            ? { httpStatus: shape.httpStatus }
            : {}),
          ...(shape.adoErrorCode ? { adoErrorCode: shape.adoErrorCode } : {}),
          severity: info.severity ?? "error",
          source: info.source,
          handled: info.handled ?? true,
        };
        // Exceptions are a Diagnostics signal; routed like any other event so
        // the sink stays oblivious to the destination table(s).
        for (const item of toTableEvents(EVENT.AppException, data))
          core.track(item);
      } catch {
        /* never throw from telemetry */
      }
    },
    flush() {
      try {
        core.flush();
      } catch {
        /* never throw from telemetry */
      }
    },
  };
}
