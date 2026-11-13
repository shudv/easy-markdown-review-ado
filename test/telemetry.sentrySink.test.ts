import { createTransport, type ErrorEvent } from "@sentry/browser";
import { afterEach, describe, expect, it } from "vitest";

import { createSentrySink, scrubEvent } from "../src/telemetry/sinks/sentrySink";
import type { TelemetryContext, TelemetrySink } from "../src/telemetry/types";

const DSN = "https://abc123@o42.ingest.us.sentry.io/4507";
const OWN = "https://emr.gallerycdn.vsassets.io/dist/pr-tab.js";
const isOwn = (url: string) => url.startsWith("https://emr.gallerycdn.vsassets.io/");

const CTX: TelemetryContext = {
    appName: "pr-tab",
    appVersion: "1.5.0",
    extensionVersion: "1.5.0.1794000000",
    environment: "production",
    locale: "de",
    installId: "i-1",
};

describe("scrubEvent", () => {
    it("redacts messages and foreign script URLs, and drops request data", () => {
        const event = scrubEvent(
            {
                type: undefined,
                message: "mail bob@contoso.com",
                request: { url: "https://dev.azure.com/org/project" },
                exception: {
                    values: [
                        {
                            value: "GET https://dev.azure.com/org/_apis failed",
                            stacktrace: {
                                frames: [
                                    { filename: OWN, lineno: 1, in_app: true },
                                    {
                                        filename: "https://elsewhere.example/x.js",
                                        abs_path: "https://elsewhere.example/x.js",
                                        in_app: true,
                                    },
                                    { function: "anonymous" },
                                ],
                            },
                        },
                        { type: "Error" },
                    ],
                },
            } as ErrorEvent,
            isOwn,
        );

        expect(event.request).toBeUndefined();
        expect(event.message).not.toContain("bob@contoso.com");
        expect(event.exception!.values![0]!.value).not.toContain("dev.azure.com");

        expect(event.exception!.values![0]!.stacktrace!.frames).toEqual([
            { filename: OWN, lineno: 1, in_app: true },
            { filename: "<redacted>", in_app: false },
            { function: "anonymous" },
        ]);
    });

    it("leaves an event without exceptions or a message alone", () => {
        expect(scrubEvent({ type: undefined }, isOwn)).toEqual({ type: undefined });
    });
});

describe("createSentrySink (on the SDK)", () => {
    let sink: TelemetrySink | null = null;

    afterEach(() => {
        sink?.discard?.();
        sink = null;
    });

    /**
     * A sink whose envelopes are captured instead of hitting the network.
     * `pageOrigin` keeps the default own-script test (this page's origin).
     */
    function captured(pageOrigin = false) {
        const events: Array<Record<string, unknown>> = [];

        sink = createSentrySink(DSN, {
            ...(pageOrigin ? {} : { isOwnScript: isOwn }),
            transport: (options) =>
                createTransport(options, (request) => {
                    const body =
                        typeof request.body === "string"
                            ? request.body
                            : new TextDecoder().decode(request.body);

                    const lines = body.split("\n").filter((line) => line !== "");

                    for (let i = 1; i < lines.length; i += 2) {
                        const header = JSON.parse(lines[i]!) as { type: string };

                        if (header.type === "event") {
                            events.push(JSON.parse(lines[i + 1]!) as Record<string, unknown>);
                        }
                    }

                    return Promise.resolve({ statusCode: 200 });
                }),
        })!;

        return { sink, events };
    }

    it("is null for an unusable DSN", () => {
        expect(createSentrySink("nonsense")).toBeNull();
        expect(createSentrySink("https://sentry.io/1")).toBeNull();
    });

    it("ignores calls before init", async () => {
        const { sink, events } = captured();
        sink.setContext(CTX);
        sink.trackEvent({ name: "comment.created" }, CTX);
        sink.trackException({ error: new Error("early") }, CTX);
        await sink.flush();

        expect(events).toEqual([]);
    });

    it("reports an exception with context, breadcrumbs and scrubbed frames", async () => {
        const { sink, events } = captured();
        sink.init(CTX);
        sink.init(CTX);
        sink.setContext({ ...CTX, locale: "fr" });
        sink.trackEvent({ name: "comment.created" }, CTX);

        const error = Object.assign(new TypeError("failed for alice@contoso.com"), {
            stack: `TypeError: failed\n    at render (${OWN}:10:5)\n    at https://elsewhere.example/b.js:3:4`,
            status: 403,
        });

        sink.trackException(
            {
                error,
                severity: "critical",
                source: "boot",
                handled: false,
                properties: { impact: "blocking" },
            },
            CTX,
        );

        await expect.poll(() => events.length).toBe(1);
        const [event] = events;

        expect(event).toMatchObject({
            level: "fatal",
            release: "easy-markdown-review@1.5.0",
            environment: "production",
            user: { id: "i-1" },
            sdk: { settings: { infer_ip: "never" } },
            tags: {
                appName: "pr-tab",
                locale: "fr",
                impact: "blocking",
                source: "boot",
                handled: "false",
                httpStatus: "403",
            },
            breadcrumbs: [{ category: "event", message: "comment.created" }],
            exception: {
                values: [{ type: "TypeError", mechanism: { type: "boot", handled: false } }],
            },
        });

        const text = JSON.stringify(event);
        expect(text).not.toContain("alice@contoso.com");
        expect(text).not.toContain("elsewhere.example");
        expect(text).toContain(OWN);
    });

    it("reduces a non-Error value to its name and message, at error level", async () => {
        const { sink, events } = captured(true);
        sink.init({ appName: "documents-hub" });
        sink.trackException({ error: { message: "nope", secret: "hidden-value" } }, {});

        await expect.poll(() => events.length).toBe(1);
        const [event] = events as [Record<string, unknown>];

        expect(event).toMatchObject({
            level: "error",
            release: "easy-markdown-review@0.0.0",
            exception: {
                values: [{ type: "Error", value: "nope", mechanism: { handled: true } }],
            },
        });
        expect(event.user ?? {}).not.toHaveProperty("id");
        expect(JSON.stringify(event)).not.toContain("hidden-value");
    });

    it("caps reports per page load", async () => {
        const { sink, events } = captured();
        sink.init(CTX);

        for (let i = 0; i < 25; i++) {
            sink.trackException({ error: new Error(`e${i}`), severity: "warning" }, CTX);
        }

        await expect.poll(() => events.length).toBe(20);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(events).toHaveLength(20);
    });

    it("stops reporting once discarded", async () => {
        const { sink, events } = captured();
        sink.init(CTX);
        sink.discard?.();
        sink.discard?.();
        sink.trackException({ error: new Error("late") }, CTX);
        sink.setContext(CTX);
        await sink.flush();
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(events).toEqual([]);
    });
});
