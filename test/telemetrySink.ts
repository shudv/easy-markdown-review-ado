// A recording telemetry sink for tests. Install it in place of the real sink so a
// test asserts what the app reports — the events and user-facing errors that reach
// the telemetry boundary — without mocking the telemetry module itself.

import { afterEach, beforeEach } from "vitest";

import { __resetTelemetryForTests } from "../src/telemetry/telemetry";
import type { TelemetryEvent, TelemetryExceptionInfo, TelemetrySink } from "../src/telemetry/types";

/** A user-facing error as `trackUserFacingError` reports it. */
export interface ReportedError {
    error: unknown;
    source: string | undefined;
    operation: unknown;
    impact: unknown;
    severity: string | undefined;
}

export interface RecordingSink {
    /** Every event passed to `track`, after sanitisation. */
    readonly events: TelemetryEvent[];
    /** Every exception passed to `trackException`, after sanitisation. */
    readonly exceptions: TelemetryExceptionInfo[];
    /** The handled, user-facing errors (`trackUserFacingError`) among `exceptions`. */
    userFacingErrors(): ReportedError[];
    /** Names of the recorded events, in order. */
    eventNames(): string[];
    /** Forget everything recorded so far. */
    clear(): void;
}

/**
 * Route telemetry to a fresh recording sink for the current test file. Call at
 * module scope or in `beforeEach`; the real (no-op) sink is restored after each
 * test.
 */
export function recordTelemetry(): RecordingSink {
    const events: TelemetryEvent[] = [];
    const exceptions: TelemetryExceptionInfo[] = [];

    const sink: TelemetrySink = {
        name: "recording",
        init: () => {},
        setContext: () => {},
        trackEvent: (event) => {
            events.push(event);
        },
        trackException: (info) => {
            exceptions.push(info);
        },
        flush: () => {},
    };

    __resetTelemetryForTests(sink);

    return {
        events,
        exceptions,
        userFacingErrors: () =>
            exceptions
                .filter((info) => info.handled === true && info.properties?.impact !== undefined)
                .map((info) => ({
                    error: info.error,
                    source: info.source,
                    operation: info.properties?.operation,
                    impact: info.properties?.impact,
                    severity: info.severity,
                })),
        eventNames: () => events.map((event) => event.name),
        clear: () => {
            events.length = 0;
            exceptions.length = 0;
        },
    };
}

/**
 * Install a recording sink before each test in the calling file and restore the
 * default sink after it. Returns a handle whose `current` sink changes per test.
 */
export function recordTelemetryEachTest(): { readonly current: RecordingSink } {
    const handle: { current: RecordingSink } = { current: recordTelemetry() };

    beforeEach(() => {
        handle.current = recordTelemetry();
    });

    afterEach(() => {
        __resetTelemetryForTests();
    });

    return handle;
}

/** @deprecated Temporary alias while files migrate to `recordTelemetryEachTest`. */
export const useRecordedTelemetry = recordTelemetryEachTest;
