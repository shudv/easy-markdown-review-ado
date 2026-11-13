// A sink whose backend loads asynchronously (the vendor SDKs are split into
// their own chunks so they never delay first paint). Calls made before the
// backend arrives are queued and replayed in order; if it fails to load, or the
// sink is discarded first, they are dropped.

import type { TelemetrySink } from "../types";

/** Calls kept while the backend loads; boot emits a handful, never this many. */
const MAX_PENDING = 200;

export function deferredSink(
    name: string,
    load: () => Promise<TelemetrySink | null>,
): TelemetrySink {
    type Call = (s: TelemetrySink) => unknown;

    let pending: Call[] | null = [];
    let backend: TelemetrySink | null = null;

    const run = (call: Call) => {
        if (backend !== null) call(backend);
        else if (pending !== null && pending.length < MAX_PENDING) pending.push(call);
    };

    load().then(
        (loaded) => {
            const calls = pending;
            pending = null;
            if (loaded === null || calls === null) return;
            backend = loaded;

            for (const call of calls) {
                try {
                    call(loaded);
                } catch {
                    /* telemetry must never break the app */
                }
            }
        },
        () => {
            pending = null;
        },
    );

    return {
        name,
        init: (ctx) => run((s) => s.init(ctx)),
        setContext: (ctx) => run((s) => s.setContext(ctx)),
        trackEvent: (event, ctx) => run((s) => s.trackEvent(event, ctx)),
        trackException: (info, ctx) => run((s) => s.trackException(info, ctx)),
        flush: () => backend?.flush(),
        discard: () => {
            pending = null;
            backend?.discard?.();
            backend = null;
        },
    };
}
