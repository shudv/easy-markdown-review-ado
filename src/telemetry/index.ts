// Public telemetry API. Import from here:
//   import { initTelemetry, track, events, setTelemetryContext } from "../telemetry";

export {
  initTelemetry,
  setTelemetryContext,
  getTelemetryContext,
  track,
  trackException,
  flushTelemetry,
} from "./telemetry";
export { events, EVENT } from "./events";
export type {
  AnchorKind,
  FileOpenSource,
  EventName,
  AppReadyReason,
} from "./events";
export { markBootStart, markAppReady } from "./bootTiming";
export { installGlobalErrorHandlers } from "./errorHandlers";
export { installAuthFailureCapture } from "./authFailureCapture";
export { ErrorBoundary } from "./ErrorBoundary";
export type {
  TelemetryContext,
  TelemetryEvent,
  TelemetryExceptionInfo,
  TelemetrySink,
} from "./types";
