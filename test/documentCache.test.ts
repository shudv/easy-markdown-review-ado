// Unit tests for the document cache (src/shell/documentCache.ts): documents
// kept by git blob id, the newest few, and never failing or changing a read.
//
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
    DOC_CACHE_KEY,
    MAX_CACHED_DOCS,
    MAX_CACHED_DOC_CHARS,
    readThroughDocCache,
} from "../src/shell/documentCache";
import {
    __resetBootTimingForTests,
    markAppReady,
    markBootStart,
} from "../src/telemetry/bootTiming";
import { recordTelemetryEachTest } from "./telemetrySink";

/** A distinct blob id for `n`. */
const blob = (n: number) => n.toString(16).padStart(40, "0");

const cachedIds = () =>
    (JSON.parse(window.localStorage.getItem(DOC_CACHE_KEY) ?? "[]") as { id: string }[]).map(
        (doc) => doc.id,
    );

const telemetry = recordTelemetryEachTest();

afterEach(() => {
    vi.restoreAllMocks();
    __resetBootTimingForTests();
    window.localStorage.clear();
});

describe("readThroughDocCache", () => {
    it("loads a blob once, then reads it from the cache", async () => {
        const load = vi.fn(async () => "# A");

        await expect(readThroughDocCache(blob(1), load)).resolves.toBe("# A");
        await expect(readThroughDocCache(blob(1), load)).resolves.toBe("# A");
        expect(load).toHaveBeenCalledOnce();
    });

    it("finds a blob whatever the case of its id", async () => {
        await readThroughDocCache(blob(10).toUpperCase(), async () => "# A");
        const load = vi.fn(async () => "# other");

        await expect(readThroughDocCache(blob(10), load)).resolves.toBe("# A");
        expect(load).not.toHaveBeenCalled();
    });

    it(`keeps the ${MAX_CACHED_DOCS} most recently loaded documents, newest first`, async () => {
        for (let n = 1; n <= MAX_CACHED_DOCS + 1; n += 1) {
            await readThroughDocCache(blob(n), async () => `# ${n}`);
        }

        expect(cachedIds()).toHaveLength(MAX_CACHED_DOCS);
        expect(cachedIds()[0]).toBe(blob(MAX_CACHED_DOCS + 1));
        expect(cachedIds()).not.toContain(blob(1));
    });

    it("doesn't cache a document over the size limit, nor drop others for it", async () => {
        await readThroughDocCache(blob(1), async () => "# A");
        const big = "x".repeat(MAX_CACHED_DOC_CHARS + 1);

        await expect(readThroughDocCache(blob(2), async () => big)).resolves.toBe(big);
        expect(cachedIds()).toEqual([blob(1)]);
    });

    it("caches a document whose stored form is right at the size limit", async () => {
        const overhead = JSON.stringify({ id: blob(1), content: "" }).length;
        await readThroughDocCache(blob(1), async () => "x".repeat(MAX_CACHED_DOC_CHARS - overhead));

        expect(cachedIds()).toEqual([blob(1)]);
    });

    it("measures the size as stored: newlines, quotes and backslashes count twice", async () => {
        // Under the limit as text, about twice over it once encoded.
        const escaped = '\n"\\'.repeat(MAX_CACHED_DOC_CHARS / 4);
        expect(escaped.length).toBeLessThan(MAX_CACHED_DOC_CHARS);

        await expect(readThroughDocCache(blob(1), async () => escaped)).resolves.toBe(escaped);
        expect(cachedIds()).toEqual([]);
    });

    it("never stores more than its documents' limits, whatever they hold", async () => {
        const overhead = JSON.stringify({ id: blob(0), content: "" }).length;
        const worst = '\n"'.repeat((MAX_CACHED_DOC_CHARS - overhead) / 4);

        for (let n = 1; n <= MAX_CACHED_DOCS + 2; n += 1) {
            await readThroughDocCache(blob(n), async () => `${worst}${n}`.slice(0, -1));
        }

        expect(cachedIds()).toHaveLength(MAX_CACHED_DOCS);
        // The list's own brackets and commas aside.
        expect(window.localStorage.getItem(DOC_CACHE_KEY)!.length).toBeLessThanOrEqual(
            MAX_CACHED_DOCS * (MAX_CACHED_DOC_CHARS + 1) + 1,
        );
    });

    it("returns the document even when storage refuses to keep it", async () => {
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new DOMException("full", "QuotaExceededError");
        });

        await expect(readThroughDocCache(blob(1), async () => "# A")).resolves.toBe("# A");
    });

    it("leaves a failed load to the caller, and caches nothing", async () => {
        await expect(
            readThroughDocCache(blob(1), () => Promise.reject(new Error("offline"))),
        ).rejects.toThrow("offline");
        expect(cachedIds()).toEqual([]);
    });

    it("tells app.loaded the first document came from the cache", async () => {
        await readThroughDocCache(blob(1), async () => "# A");
        markBootStart();
        await readThroughDocCache(blob(1), async () => "# A");
        markAppReady("content");

        const loaded = telemetry.current.events.find((e) => e.name === "app.loaded");
        expect(loaded?.properties).toMatchObject({ cache: "doc" });
    });
});
