import { afterEach, describe, expect, it, vi } from "vitest";

import {
    createSentrySink,
    debugIdsByFile,
    parseDsn,
    parseStack,
    sentryEvent,
} from "../src/telemetry/sinks/sentrySink";
import { browserTransport, type Transport } from "../src/telemetry/sinks/transport";
import type { TelemetryContext } from "../src/telemetry/types";

const DSN = "https://abc123@o42.ingest.us.sentry.io/4507";
const OWN = "https://shudv.gallerycdn.vsassets.io/extensions/dist/pr-tab/pr-tab.js";
const isOwn = (url: string) => url.startsWith("https://shudv.gallerycdn.vsassets.io/");
const NOW = new Date("2026-11-13T10:00:00.000Z");

const CTX: TelemetryContext = {
    appName: "pr-tab",
    appVersion: "1.5.0",
    environment: "production",
    installId: "i-1",
};

describe("parseDsn", () => {
    it("builds the envelope URL with query-string auth", () => {
        expect(parseDsn(DSN)).toEqual({
            dsn: DSN,
            envelopeUrl:
                "https://o42.ingest.us.sentry.io/api/4507/envelope/?sentry_key=abc123&sentry_version=7&sentry_client=emr.breeze%2F1",
        });
    });

    it("keeps a path prefix (self-hosted Sentry)", () => {
        expect(parseDsn("https://k@sentry.example.com/base/12")?.envelopeUrl).toMatch(
            /^https:\/\/sentry\.example\.com\/base\/api\/12\/envelope\/\?/,
        );
    });

    it.each([
        ["an unparseable DSN", "not a url"],
        ["an http DSN", "http://k@sentry.example.com/1"],
        ["a DSN without a key", "https://sentry.example.com/1"],
        ["a DSN without a project", "https://k@sentry.example.com/"],
    ])("rejects %s", (_, dsn) => {
        expect(parseDsn(dsn)).toBeNull();
    });
});

describe("parseStack", () => {
    it("parses Chromium frames oldest first and redacts foreign URLs", () => {
        const stack = [
            "TypeError: boom",
            `    at render (${OWN}:10:20)`,
            `    at ${OWN}:30:40`,
            "    at https://other.example/lib.js:1:2",
            "    at <anonymous>",
        ].join("\n");

        expect(parseStack(stack, isOwn)).toEqual([
            { filename: "<redacted>", lineno: 1, colno: 2, in_app: false },
            { filename: OWN, lineno: 30, colno: 40, in_app: true },
            { function: "render", filename: OWN, lineno: 10, colno: 20, in_app: true },
        ]);
    });

    it("parses Firefox / Safari frames", () => {
        expect(parseStack(`render@${OWN}:5:6\n@${OWN}:7:8`, isOwn)).toEqual([
            { filename: OWN, lineno: 7, colno: 8, in_app: true },
            { function: "render", filename: OWN, lineno: 5, colno: 6, in_app: true },
        ]);
    });
});

describe("debugIdsByFile", () => {
    it("maps each stamped bundle to its debug id", () => {
        const stamps = {
            [`Error\n    at ${OWN}:1:1`]: "debug-1",
            "Error\n    at https://other.example/x.js:1:1": "debug-2",
            "no frames here": "debug-3",
        };

        expect([...debugIdsByFile(stamps, isOwn)]).toEqual([[OWN, "debug-1"]]);
    });

    it("is empty when nothing was stamped", () => {
        expect(debugIdsByFile(undefined, isOwn).size).toBe(0);
    });
});

describe("sentryEvent", () => {
    const opts = { eventId: "e".repeat(32), now: NOW, isOwnScript: isOwn };

    it("reports a scrubbed, symbolicatable exception", () => {
        const error = Object.assign(new TypeError("no access for bob@contoso.com"), {
            stack: `TypeError: x\n    at render (${OWN}:10:20)`,
            status: 403,
        });

        const event = sentryEvent(
            {
                error,
                severity: "critical",
                source: "boot",
                handled: false,
                properties: { impact: "blocking" },
            },
            CTX,
            { ...opts, debugIds: new Map([[OWN, "debug-1"]]) },
        );

        expect(event).toMatchObject({
            event_id: opts.eventId,
            timestamp: NOW.getTime() / 1000,
            platform: "javascript",
            sdk: { settings: { infer_ip: "never" } },
            level: "fatal",
            release: "easy-markdown-review@1.5.0",
            environment: "production",
            user: { id: "i-1" },
            tags: {
                impact: "blocking",
                appName: "pr-tab",
                source: "boot",
                handled: "false",
                httpStatus: "403",
            },
            exception: {
                values: [
                    {
                        type: "TypeError",
                        stacktrace: { frames: [{ function: "render", filename: OWN, lineno: 10 }] },
                        mechanism: { type: "boot", handled: false },
                    },
                ],
            },
            debug_meta: { images: [{ type: "sourcemap", code_file: OWN, debug_id: "debug-1" }] },
        });
        expect(JSON.stringify(event)).not.toContain("bob@contoso.com");
    });

    it("sends a bare thrown value without a stack, debug meta or user", () => {
        const event = sentryEvent(
            { error: "boom" },
            {},
            { ...opts, debugIds: new Map() },
        ) as Record<string, unknown>;

        expect(event).toMatchObject({
            level: "error",
            release: "easy-markdown-review@0.0.0",
            exception: {
                values: [
                    { type: "Error", value: "boom", mechanism: { type: "generic", handled: true } },
                ],
            },
        });
        expect(event.user).toBeUndefined();
        expect(event).not.toHaveProperty("debug_meta");
        expect(JSON.stringify(event)).not.toContain("stacktrace");
    });

    it.each([
        ["info", "info"],
        ["warning", "warning"],
    ] as const)("maps %s severity to Sentry's %s level", (severity, level) => {
        expect(
            sentryEvent({ error: "x", severity }, CTX, { ...opts, debugIds: new Map() }),
        ).toMatchObject({ level });
    });
});

describe("createSentrySink", () => {
    afterEach(() => {
        delete globalThis._sentryDebugIds;
    });

    it("is null for an unusable DSN", () => {
        expect(createSentrySink("nonsense")).toBeNull();
    });

    it("posts one envelope per exception, capped per load, and ignores product events", () => {
        const post = vi.fn();
        const transport: Transport = { post, beacon: vi.fn(() => true) };
        globalThis._sentryDebugIds = { [`Error\n    at ${OWN}:1:1`]: "debug-1" };
        const sink = createSentrySink(DSN, { transport, now: () => NOW, isOwnScript: isOwn })!;
        sink.init(CTX);
        sink.setContext(CTX);
        sink.trackEvent({ name: "comment.created" }, CTX);
        void sink.flush();
        expect(post).not.toHaveBeenCalled();

        for (let i = 0; i < 25; i++) sink.trackException({ error: new Error(`e${i}`) }, CTX);

        expect(post).toHaveBeenCalledTimes(20);
        const [url, body, keepalive] = post.mock.calls[0] as [string, string, boolean];
        expect(keepalive).toBe(true);

        const [header, item, event] = body
            .trimEnd()
            .split("\n")
            .map((line) => JSON.parse(line) as Record<string, unknown>);

        expect(url).toBe(parseDsn(DSN)!.envelopeUrl);
        expect(header).toMatchObject({ dsn: DSN, sent_at: NOW.toISOString() });
        expect(header!.event_id).toMatch(/^[0-9a-f]{32}$/);
        expect(item).toEqual({ type: "event" });
        expect(event).toMatchObject({ event_id: header!.event_id });
    });

    it("treats scripts from this page's origin as its own by default", () => {
        const post = vi.fn();
        const sink = createSentrySink(DSN, { transport: { post, beacon: () => true } })!;

        const error = Object.assign(new Error("x"), {
            stack: `Error: x\n    at ${window.location.origin}/dist/a.js:1:2\n    at https://elsewhere.example/b.js:3:4`,
        });

        sink.trackException({ error }, CTX);

        const frames = JSON.stringify(
            JSON.parse((post.mock.calls[0]![1] as string).split("\n")[2]!),
        );

        expect(frames).toContain(`${window.location.origin}/dist/a.js`);
        expect(frames).not.toContain("elsewhere.example");
    });
});

describe("browserTransport", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("posts text/plain, without keepalive unless asked, and swallows network failures", async () => {
        const fetchMock = vi.fn(() => Promise.reject(new Error("offline")));
        vi.stubGlobal("fetch", fetchMock);

        browserTransport.post("https://collector.example/track", "[]");
        await Promise.resolve();

        expect(fetchMock).toHaveBeenCalledWith("https://collector.example/track", {
            method: "POST",
            body: "[]",
            keepalive: false,
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
        });
    });

    it("keeps keepalive requests within the browser's in-flight budget", async () => {
        const settle: Array<() => void> = [];

        const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
            () =>
                new Promise((resolve) => {
                    settle.push(() => resolve(new Response()));
                }),
        );

        vi.stubGlobal("fetch", fetchMock);
        const keepalive = () => fetchMock.mock.calls.map(([, init]) => init.keepalive);

        // 15 requests at most…
        for (let i = 0; i < 16; i++) browserTransport.post("https://c.example/", "x", true);
        expect(keepalive().slice(-2)).toEqual([true, false]);

        // …and freed once they settle.
        for (const done of settle.splice(0)) done();
        await new Promise((resolve) => setTimeout(resolve, 0));
        browserTransport.post("https://c.example/", "x".repeat(50_000), true);
        browserTransport.post("https://c.example/", "x".repeat(20_000), true);
        expect(keepalive().slice(-2)).toEqual([true, false]);

        for (const done of settle.splice(0)) done();
        await new Promise((resolve) => setTimeout(resolve, 0));
    });

    it("beacons when the browser supports it", () => {
        const sendBeacon = vi.fn(() => true);
        vi.stubGlobal("navigator", { sendBeacon });

        expect(browserTransport.beacon("https://collector.example/track", "[]")).toBe(true);
        expect(sendBeacon).toHaveBeenCalledWith(
            "https://collector.example/track",
            expect.any(Blob),
        );
    });

    it("reports a refused beacon where the browser lacks sendBeacon", () => {
        vi.stubGlobal("navigator", {});

        expect(browserTransport.beacon("https://collector.example/track", "[]")).toBe(false);
    });
});
