// The network edge shared by the telemetry sinks: a fire-and-forget POST, and
// `sendBeacon` for the page going away (a plain request may be cancelled
// then). Bodies go as text/plain so the request is "simple" — no CORS
// preflight — which both Application Insights and Sentry ingestion accept.

export interface Transport {
    /**
     * Send now; failures are swallowed (telemetry is best effort). `keepalive`
     * asks the request to outlive the page, within the browser's budget.
     */
    post(url: string, body: string, keepalive?: boolean): void;
    /** Queue for delivery even if the page unloads; false if the browser refused. */
    beacon(url: string, body: string): boolean;
}

const TEXT_PLAIN = "text/plain;charset=UTF-8";

// Browsers reject keepalive requests once the page's in-flight keepalive
// bodies pass 64 KB, so stay under it and send plainly beyond that.
const KEEPALIVE_MAX_BYTES = 60_000;
const KEEPALIVE_MAX_REQUESTS = 15;
let keepaliveBytes = 0;
let keepaliveRequests = 0;

export const browserTransport: Transport = {
    post(url, body, keepalive = false) {
        const bytes = new TextEncoder().encode(body).length;

        const useKeepalive =
            keepalive &&
            keepaliveRequests < KEEPALIVE_MAX_REQUESTS &&
            keepaliveBytes + bytes <= KEEPALIVE_MAX_BYTES;

        if (useKeepalive) {
            keepaliveBytes += bytes;
            keepaliveRequests++;
        }

        void fetch(url, {
            method: "POST",
            body,
            keepalive: useKeepalive,
            headers: { "Content-Type": TEXT_PLAIN },
        })
            .catch(() => {})
            .finally(() => {
                if (useKeepalive) {
                    keepaliveBytes -= bytes;
                    keepaliveRequests--;
                }
            });
    },
    beacon(url, body) {
        return (
            typeof navigator.sendBeacon === "function" &&
            navigator.sendBeacon(url, new Blob([body], { type: TEXT_PLAIN }))
        );
    },
};
