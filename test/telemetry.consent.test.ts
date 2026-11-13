// The "Send usage data" opt-out: the persisted choice, and the facade honouring
// it — nothing is sent or persisted when it's off, and turning it off mid-session
// drops queued data and forgets the install id.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    readUsageDataEnabled,
    USAGE_DATA_STORAGE_KEY,
    writeUsageDataEnabled,
} from "../src/telemetry/consent";
import { events } from "../src/telemetry/events";
import {
    __resetTelemetryForTests,
    getTelemetryContext,
    initTelemetry,
    INSTALL_ID_STORAGE_KEY,
    setUsageDataEnabled,
    track,
} from "../src/telemetry/telemetry";

const CONNECTION =
    "InstrumentationKey=abc;IngestionEndpoint=https://x.in.applicationinsights.azure.com/";

const DSN = "https://k@o1.ingest.sentry.io/2";
const globals = globalThis as Record<string, unknown>;

function configure(config: Record<string, unknown>) {
    globals.__EMR_TELEMETRY_CONFIG__ = { appVersion: "1.5.0", ...config };
}

beforeEach(() => {
    __resetTelemetryForTests();
});

afterEach(() => {
    __resetTelemetryForTests();
    delete globals.__EMR_TELEMETRY_CONFIG__;
    window.localStorage.removeItem(USAGE_DATA_STORAGE_KEY);
    window.localStorage.removeItem(INSTALL_ID_STORAGE_KEY);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("usage-data consent", () => {
    it("is on by default and persists only the opt-out", () => {
        expect(readUsageDataEnabled()).toBe(true);

        writeUsageDataEnabled(false);
        expect(window.localStorage.getItem(USAGE_DATA_STORAGE_KEY)).toBe("off");
        expect(readUsageDataEnabled()).toBe(false);

        writeUsageDataEnabled(true);
        expect(window.localStorage.getItem(USAGE_DATA_STORAGE_KEY)).toBeNull();
        expect(readUsageDataEnabled()).toBe(true);
    });

    it("defaults to on, and never throws, when storage is blocked", () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new DOMException("blocked", "SecurityError");
        });
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new DOMException("blocked", "SecurityError");
        });

        expect(readUsageDataEnabled()).toBe(true);
        expect(() => writeUsageDataEnabled(false)).not.toThrow();
    });
});

describe("telemetry with Application Insights and Sentry configured", () => {
    function stubFetch() {
        const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
            Promise.resolve(new Response(null)),
        );

        vi.stubGlobal("fetch", fetchMock);

        return fetchMock;
    }

    it("sends usage events to Application Insights", async () => {
        configure({ key: CONNECTION, errorDsn: DSN });
        const fetchMock = stubFetch();

        initTelemetry({ appName: "pr-tab" });
        track(events.appLoaded());
        await Promise.resolve();
        window.dispatchEvent(new Event("pagehide"));

        expect(fetchMock.mock.calls.some(([url]) => url.includes("applicationinsights"))).toBe(
            true,
        );
    });

    it("sends nothing and persists no install id when the user opted out", () => {
        configure({ key: CONNECTION });
        writeUsageDataEnabled(false);
        const fetchMock = stubFetch();

        initTelemetry({ appName: "pr-tab" });
        track(events.appLoaded());
        window.dispatchEvent(new Event("pagehide"));

        expect(fetchMock).not.toHaveBeenCalled();
        expect(getTelemetryContext().installId).toBeUndefined();
        expect(window.localStorage.getItem(INSTALL_ID_STORAGE_KEY)).toBeNull();
    });

    it("drops queued data and forgets the install id when turned off mid-session", () => {
        configure({ key: CONNECTION });
        const fetchMock = stubFetch();
        initTelemetry({ appName: "pr-tab" });
        track(events.appLoaded());
        expect(window.localStorage.getItem(INSTALL_ID_STORAGE_KEY)).not.toBeNull();

        setUsageDataEnabled(false);
        window.dispatchEvent(new Event("pagehide"));

        expect(fetchMock).not.toHaveBeenCalled();
        expect(window.localStorage.getItem(INSTALL_ID_STORAGE_KEY)).toBeNull();
        expect(getTelemetryContext().installId).toBeUndefined();
        expect(readUsageDataEnabled()).toBe(false);
    });

    it("resumes when turned back on", () => {
        configure({ key: CONNECTION });
        writeUsageDataEnabled(false);
        const fetchMock = stubFetch();
        initTelemetry({ appName: "pr-tab" });

        setUsageDataEnabled(true);
        track(events.appLoaded());
        window.dispatchEvent(new Event("pagehide"));

        expect(fetchMock).toHaveBeenCalled();
        expect(getTelemetryContext().installId).toMatch(/^[\w-]+$/);
        // Already on: a second call changes nothing.
        setUsageDataEnabled(true);
        expect(readUsageDataEnabled()).toBe(true);
    });

    it("stays off when re-enabled before telemetry started", () => {
        expect(() => setUsageDataEnabled(true)).not.toThrow();
        expect(getTelemetryContext()).toEqual({});
    });

    it("warns and stays off when the configured credentials are unusable", () => {
        configure({ key: "nonsense", errorDsn: "also nonsense" });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const fetchMock = stubFetch();

        initTelemetry({ appName: "pr-tab" });
        track(events.appLoaded());

        expect(warn).toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
