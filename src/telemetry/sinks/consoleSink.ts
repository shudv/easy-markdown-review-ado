// Console sink — developer visibility. Used when `debug` is set in the build
// config (or, in development, as a stand-in for a real backend) so engineers
// can watch the exact, already-sanitised payloads that *would* be sent without
// provisioning a collector.

import type {
  TelemetryContext,
  TelemetryEvent,
  TelemetryExceptionInfo,
  TelemetrySink,
} from "../types";
import { describeError } from "../errorShape";

export const consoleSink: TelemetrySink = {
  name: "console",
  init(context: TelemetryContext) {
    // eslint-disable-next-line no-console
    console.info("[telemetry] init", context);
  },
  setContext(context: TelemetryContext) {
    // eslint-disable-next-line no-console
    console.debug("[telemetry] context", context);
  },
  trackEvent(event: TelemetryEvent, context: TelemetryContext) {
    // eslint-disable-next-line no-console
    console.info("[telemetry] event", event.name, {
      properties: event.properties,
      measurements: event.measurements,
      context,
    });
  },
  trackException(info: TelemetryExceptionInfo, context: TelemetryContext) {
    console.error("[telemetry] exception", {
      ...describeError(info.error),
      severity: info.severity,
      source: info.source,
      handled: info.handled,
      properties: info.properties,
      context,
    });
  },
  flush() {},
};
