// The "Send usage data" opt-out: the persisted choice, and the facade honouring
// it — nothing is loaded, sent or persisted when it's off, and turning it off
// mid-session discards the backends and forgets the install id.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    readUsageDataEnabled,
    USAGE_DATA_STORAGE_KEY,
    writeUsageDataEnabled,
} from "../src/telemetry/consent";
import { events } from "../src/telemetry/events";
import { createAppInsightsSink } from "../src/telemetry/sinks/appInsightsSink";
import { createSentrySink } from "../src/telemetry/sinks/sentrySink";
import {
    __resetTelemetryForTests,
    getTelemetryContext,
    initTelemetry,
    INSTALL_ID_STORAGE_KEY,
    isTelemetryConfigured,
    setUsageDataEnabled,
    track,
} from "../src/telemetry/telemetry";
import type { TelemetrySink } from "../src/telemetry/types";

function fakeSink(name: string) {
    return {
        name,
        init: vi.fn(),
        setContext: vi.fn(),
        trackEvent: vi.fn(),
        trackException: vi.fn(),
        flush: vi.fn(),
        discard: vi.fn(),
    } satisfies TelemetrySink;
}

const { appInsights, sentry } = vi.hoisted(() => ({
    appInsights: {} as ReturnType<typeof fakeSink>,
    sentry: {} as ReturnType<typeof fakeSink>,
}));

vi.mock("../src/telemetry/sinks/appInsightsSink", () => ({
    createAppInsightsSink: vi.fn(() => appInsights),
}));

vi.mock("../src/telemetry/sinks/sentrySink", () => ({
    createSentrySink: vi.fn(() => sentry),
}));

const CONNECTION =
    "InstrumentationKey=abc;IngestionEndpoint=https://x.in.applicationinsights.azure.com/";

const DSN = "https://k@o1.ingest.sentry.io/2";
const globals = globalThis as Record<string, unknown>;

function configure(config: Record<string, unknown>) {
    globals.__EMR_TELEMETRY_CONFIG__ = { appVersion: "1.5.0", ...config };
}

beforeEach(() => {
    __resetTelemetryForTests();
    Object.assign(appInsights, fakeSink("appinsights"));
    Object.assign(sentry, fakeSink("sentry"));
    vi.mocked(createAppInsightsSink).mockClear();
    vi.mocked(createSentrySink).mockClear();
});

afterEach(() => {
    __resetTelemetryForTests();
    delete globals.__EMR_TELEMETRY_CONFIG__;
    window.localStorage.removeItem(USAGE_DATA_STORAGE_KEY);
    window.localStorage.removeItem(INSTALL_ID_STORAGE_KEY);
    vi.restoreAllMocks();
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
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("loads both backends and forwards to them", async () => {
        configure({ key: CONNECTION, errorDsn: DSN });

        initTelemetry({ appName: "pr-tab" });
        track(events.appLoaded());
        await settle();

        expect(createAppInsightsSink).toHaveBeenCalledWith(CONNECTION);
        expect(createSentrySink).toHaveBeenCalledWith(DSN);
        expect(appInsights.trackEvent).toHaveBeenCalledTimes(1);
        expect(sentry.trackEvent).toHaveBeenCalledTimes(1);
    });

    it("loads nothing and persists no install id when the user opted out", async () => {
        configure({ key: CONNECTION });
        writeUsageDataEnabled(false);

        initTelemetry({ appName: "pr-tab" });
        track(events.appLoaded());
        await settle();

        expect(createAppInsightsSink).not.toHaveBeenCalled();
        expect(getTelemetryContext().installId).toBeUndefined();
        expect(window.localStorage.getItem(INSTALL_ID_STORAGE_KEY)).toBeNull();
    });

    it("discards the backends and forgets the install id when turned off mid-session", async () => {
        configure({ key: CONNECTION });
        initTelemetry({ appName: "pr-tab" });
        await settle();
        expect(window.localStorage.getItem(INSTALL_ID_STORAGE_KEY)).not.toBeNull();

        setUsageDataEnabled(false);
        track(events.appLoaded());

        expect(appInsights.discard).toHaveBeenCalledTimes(1);
        expect(appInsights.trackEvent).not.toHaveBeenCalled();
        expect(window.localStorage.getItem(INSTALL_ID_STORAGE_KEY)).toBeNull();
        expect(getTelemetryContext().installId).toBeUndefined();
        expect(readUsageDataEnabled()).toBe(false);
    });

    it("resumes when turned back on", async () => {
        configure({ key: CONNECTION });
        writeUsageDataEnabled(false);
        initTelemetry({ appName: "pr-tab" });

        setUsageDataEnabled(true);
        track(events.appLoaded());
        await settle();

        expect(appInsights.trackEvent).toHaveBeenCalledTimes(1);
        expect(getTelemetryContext().installId).toMatch(/^[\w-]+$/);
        // Already on: a second call changes nothing.
        setUsageDataEnabled(true);
        expect(createAppInsightsSink).toHaveBeenCalledTimes(1);
    });

    it("stays off when re-enabled before telemetry started", () => {
        expect(() => setUsageDataEnabled(true)).not.toThrow();
        expect(getTelemetryContext()).toEqual({});
    });

    it("warns and stays off when the configured credentials are unusable", async () => {
        configure({ key: "nonsense", errorDsn: "also nonsense" });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        initTelemetry({ appName: "pr-tab" });
        track(events.appLoaded());
        await settle();

        expect(warn).toHaveBeenCalled();
        expect(createAppInsightsSink).not.toHaveBeenCalled();
        expect(createSentrySink).not.toHaveBeenCalled();
    });

    it("reports whether the build sends telemetry", () => {
        expect(isTelemetryConfigured()).toBe(false);
        configure({ errorDsn: DSN });
        expect(isTelemetryConfigured()).toBe(true);
    });
});
