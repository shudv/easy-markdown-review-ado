// Public telemetry API. Import from here:
//   import { initTelemetry, track, events, setTelemetryContext } from "../telemetry";

export {
    initTelemetry,
    setTelemetryContext,
    getTelemetryContext,
    track,
    trackUserFacingError,
} from "./telemetry";
export { events, EVENT } from "./events";
export type { AnchorKind, HeldWriteKind, HeldWriteOutcome, ResolveVia } from "./events";
export {
    markBootStart,
    markBootPhase,
    markBootAuthWaitStart,
    markBootAuthWaitEnd,
    markBootAfterAutoReload,
    markAppReady,
    noteBootCache,
    noteBootShape,
} from "./bootTiming";
export { claimUnhandledRejections, installGlobalErrorHandlers } from "./errorHandlers";
export { installAuthFailureCapture } from "./authFailureCapture";
export { ErrorBoundary } from "./ErrorBoundary";
