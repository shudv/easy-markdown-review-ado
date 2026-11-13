import { describe, expect, it, vi } from "vitest";

import { isUsableDsn, parseConnectionString } from "../src/telemetry/sinks/credentials";
import { deferredSink } from "../src/telemetry/sinks/deferredSink";
import type { TelemetrySink } from "../src/telemetry/types";

describe("parseConnectionString", () => {
    it("reads the ingestion endpoint", () => {
        expect(
            parseConnectionString(
                "InstrumentationKey=k;IngestionEndpoint=https://westeurope-5.in.applicationinsights.azure.com/;LiveEndpoint=https://x/",
            ),
        ).toEqual({ ingestionEndpoint: "https://westeurope-5.in.applicationinsights.azure.com" });
    });

    it("defaults the endpoint and ignores key case and malformed parts", () => {
        expect(parseConnectionString("instrumentationkey=abc;junk;=x")).toEqual({
            ingestionEndpoint: "https://dc.services.visualstudio.com",
        });
    });

    it.each([
        ["no instrumentation key", "IngestionEndpoint=https://x.example/"],
        ["an http endpoint", "InstrumentationKey=abc;IngestionEndpoint=http://x.example/"],
        ["an empty string", ""],
    ])("rejects %s", (_, raw) => {
        expect(parseConnectionString(raw)).toBeNull();
    });
});

describe("isUsableDsn", () => {
    it.each([
        ["https://abc@o1.ingest.sentry.io/42", true],
        ["https://abc@sentry.example/prefix/42", true],
        ["wss://abc@o1.ingest.sentry.io/42", false],
        ["https://o1.ingest.sentry.io/42", false],
        ["https://abc@o1.ingest.sentry.io/", false],
        ["nonsense", false],
    ])("%s → %s", (dsn, usable) => {
        expect(isUsableDsn(dsn)).toBe(usable);
    });
});

function fakeSink() {
    return {
        name: "fake",
        init: vi.fn<TelemetrySink["init"]>(),
        setContext: vi.fn<TelemetrySink["setContext"]>(),
        trackEvent: vi.fn<TelemetrySink["trackEvent"]>(),
        trackException: vi.fn<TelemetrySink["trackException"]>(),
        flush: vi.fn<TelemetrySink["flush"]>(),
        discard: vi.fn<NonNullable<TelemetrySink["discard"]>>(),
    } satisfies TelemetrySink;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("deferredSink", () => {
    it("queues calls until the backend loads, replays them in order, then forwards", async () => {
        const backend = fakeSink();
        const order: string[] = [];
        backend.init.mockImplementation(() => order.push("init"));

        backend.trackEvent.mockImplementation(() => {
            order.push("event");
            throw new Error("a failing replay must not stop the rest");
        });

        backend.trackException.mockImplementation(() => order.push("exception"));
        const sink = deferredSink("x", () => Promise.resolve(backend));

        sink.init({});
        sink.setContext({ locale: "de" });
        sink.trackEvent({ name: "app.loaded" }, {});
        sink.trackException({ error: new Error("x") }, {});
        expect(sink.flush()).toBeUndefined();
        expect(backend.init).not.toHaveBeenCalled();

        await settle();
        expect(order).toEqual(["init", "event", "exception"]);
        expect(backend.setContext).toHaveBeenCalledWith({ locale: "de" });

        void sink.flush();
        expect(backend.flush).toHaveBeenCalledTimes(1);
        sink.discard?.();
        expect(backend.discard).toHaveBeenCalledTimes(1);
        sink.trackEvent({ name: "late" }, {});
        expect(backend.trackEvent).toHaveBeenCalledTimes(1);
    });

    it("keeps a bounded queue while loading", async () => {
        const backend = fakeSink();
        const sink = deferredSink("x", () => Promise.resolve(backend));
        for (let i = 0; i < 250; i++) sink.trackEvent({ name: "e" }, {});
        await settle();

        expect(backend.trackEvent).toHaveBeenCalledTimes(200);
    });

    it("drops everything when discarded before the backend arrives", async () => {
        const backend = fakeSink();
        const sink = deferredSink("x", () => Promise.resolve(backend));
        sink.trackEvent({ name: "e" }, {});
        sink.discard?.();
        await settle();
        sink.trackEvent({ name: "e" }, {});

        expect(backend.trackEvent).not.toHaveBeenCalled();
        expect(backend.discard).not.toHaveBeenCalled();
    });

    it.each([
        ["resolves to nothing", () => Promise.resolve(null)],
        ["fails to load", () => Promise.reject(new Error("chunk failed"))],
    ])("drops everything when the backend %s", async (_, load) => {
        const sink = deferredSink("x", load);
        sink.trackEvent({ name: "e" }, {});
        await settle();

        expect(() => {
            sink.trackEvent({ name: "e" }, {});
            void sink.flush();
            sink.discard?.();
        }).not.toThrow();
    });
});
