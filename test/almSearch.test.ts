// Tests for the typed ALM Search REST wrapper. Uses an injected fake
// `fetch` so we can pin URL composition, headers, body, and the full
// error-mapping table without a real network.

import { describe, expect, it, vi } from "vitest";

import {
    AlmSearchError,
    AlmSearchRestClient,
    createAlmSearchClient,
    isAlmSearchError,
    outcomeFromError,
    statusToKind,
    type CodeSearchRequest,
} from "../src/shell/almSearch";

const REQ: CodeSearchRequest = {
    searchText: "file:overview.md",
    $top: 25,
};

/** No-op backoff so the internal retry loop runs instantly + deterministically. */
const noSleep = async () => {};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
        ...init,
    });
}

describe("statusToKind", () => {
    it.each([
        [404, "extension-missing"],
        [401, "auth"],
        [403, "auth"],
        [400, "bad-request"],
        [500, "unknown"],
        [503, "unknown"],
    ] as const)("maps HTTP %i → %s", (status, kind) => {
        expect(statusToKind(status)).toBe(kind);
    });
});

describe("isAlmSearchError", () => {
    it("recognises a search failure and exposes its kind, status and message", () => {
        const e = new AlmSearchError("auth", "unauthorized", 401);

        expect(isAlmSearchError(e)).toBe(true);
        expect(e).toBeInstanceOf(Error);
        expect(e).toMatchObject({
            name: "AlmSearchError",
            kind: "auth",
            status: 401,
            message: "unauthorized",
        });
    });

    it("recognises a network failure, which carries no HTTP status", () => {
        const e = new AlmSearchError("network", "offline");

        expect(isAlmSearchError(e)).toBe(true);
        expect(e.status).toBeUndefined();
    });

    it.each([
        { name: "a plain Error", value: new Error("nope") },
        { name: "null", value: null },
        { name: "a string", value: "kind" },
        { name: "an empty object", value: {} },
        { name: "an object with a non-string kind", value: { kind: 123 } },
        { name: "a plain object shaped like a search error", value: { kind: "auth", status: 401 } },
    ])("does not treat $name as a search failure", ({ value }) => {
        expect(isAlmSearchError(value)).toBe(false);
    });
});

describe("AlmSearchRestClient", () => {
    it("composes the URL with encoded org + project and sends the request body", async () => {
        const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ count: 0, results: [] }));

        const client = new AlmSearchRestClient("my org", async () => "TOK", fetchImpl);

        await client.searchCode(REQ, "Spaces Project");
        expect(fetchImpl).toHaveBeenCalledOnce();
        const [url, init] = fetchImpl.mock.calls[0]!;
        expect(url).toBe(
            "https://almsearch.dev.azure.com/my%20org/Spaces%20Project" +
                "/_apis/search/codesearchresults?api-version=7.1-preview.1",
        );
        const reqInit = init as RequestInit;
        expect(reqInit.method).toBe("POST");
        const headers = reqInit.headers as Record<string, string>;
        expect(headers["Authorization"]).toBe("Bearer TOK");
        expect(headers["Content-Type"]).toBe("application/json");
        expect(JSON.parse(reqInit.body as string)).toEqual(REQ);
    });

    it("returns the parsed response body on success", async () => {
        const fetchImpl = vi.fn(async () =>
            jsonResponse({
                count: 1,
                results: [{ fileName: "a.md", path: "/a.md" }],
            }),
        );

        const client = new AlmSearchRestClient("org", async () => "TOK", fetchImpl);

        const res = await client.searchCode(REQ, "P");
        expect(res.count).toBe(1);
        expect(res.results?.[0]?.fileName).toBe("a.md");
    });

    it("defaults to the global fetch when none is injected", async () => {
        const globalFetch = vi.fn(async () => jsonResponse({ count: 2 }));
        vi.stubGlobal("fetch", globalFetch);

        try {
            const client = new AlmSearchRestClient("org", async () => "TOK");
            const res = await client.searchCode(REQ, "P");
            expect(res.count).toBe(2);
            expect(globalFetch).toHaveBeenCalledOnce();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("lets the caller cancel the request", async () => {
        const fetchImpl = vi.fn(async () => jsonResponse({}));
        const client = new AlmSearchRestClient("org", async () => "TOK", fetchImpl);
        const ac = new AbortController();

        await client.searchCode(REQ, "P", ac.signal);

        expect(fetchImpl).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ signal: ac.signal }),
        );
    });

    it("preserves an AbortError instead of reporting it as a network failure", async () => {
        const ac = new AbortController();

        const fetchImpl = vi.fn(async () => {
            ac.abort();
            const e = new Error("aborted");
            e.name = "AbortError";
            throw e;
        });

        const client = new AlmSearchRestClient("org", async () => "TOK", fetchImpl, noSleep);

        await expect(client.searchCode(REQ, "P", ac.signal)).rejects.toMatchObject({
            name: "AbortError",
        });
    });

    it("reports a usable message even when the network failure can't be turned into text", async () => {
        const hostile = {
            [Symbol.toPrimitive]() {
                throw new Error("cannot stringify");
            },
        };

        const client = new AlmSearchRestClient(
            "org",
            async () => "TOK",
            vi.fn(async () => {
                throw hostile;
            }),
            noSleep,
        );

        await expect(client.searchCode(REQ, "P")).rejects.toMatchObject({
            kind: "network",
            message: "unknown error",
        });
    });

    it("throws an auth error when the token provider rejects", async () => {
        const client = new AlmSearchRestClient(
            "org",
            async () => {
                throw new Error("token boom");
            },
            vi.fn(),
            noSleep,
        );

        await expect(client.searchCode(REQ, "P")).rejects.toMatchObject({
            kind: "auth",
            message: "token boom",
        });
    });

    it("throws an auth error when the token provider returns an empty string", async () => {
        const client = new AlmSearchRestClient("org", async () => "", vi.fn(), noSleep);

        await expect(client.searchCode(REQ, "P")).rejects.toMatchObject({
            kind: "auth",
            message: "empty access token",
        });
    });

    it("classifies fetch-thrown errors as `network`", async () => {
        const fetchImpl = vi.fn(async () => {
            throw new TypeError("offline");
        });

        const client = new AlmSearchRestClient("org", async () => "TOK", fetchImpl, noSleep);

        await expect(client.searchCode(REQ, "P")).rejects.toMatchObject({
            kind: "network",
            message: "offline",
        });
    });

    it.each([
        [404, "extension-missing"],
        [401, "auth"],
        [403, "auth"],
        [400, "bad-request"],
        [500, "unknown"],
    ] as const)("maps a non-OK %i response to a `%s` AlmSearchError", async (status, kind) => {
        const fetchImpl = vi.fn(
            async () =>
                new Response("err", {
                    status,
                    statusText: `status ${status}`,
                }),
        );

        const client = new AlmSearchRestClient("org", async () => "TOK", fetchImpl, noSleep);

        const err: unknown = await client.searchCode(REQ, "P").catch((e) => e);

        expect(err).toBeInstanceOf(AlmSearchError);
        expect(err).toMatchObject({
            name: "AlmSearchError",
            kind,
            status,
            message: `status ${status}`,
        });
    });

    it("classifies a malformed JSON response as `unknown`", async () => {
        const fetchImpl = vi.fn(
            async () =>
                new Response("<not json>", {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }),
        );

        const client = new AlmSearchRestClient("org", async () => "TOK", fetchImpl);

        await expect(client.searchCode(REQ, "P")).rejects.toMatchObject({
            kind: "unknown",
            status: 200,
        });
    });

    describe("token re-acquisition on retry", () => {
        it("re-acquires a fresh token on every attempt", async () => {
            // First attempt gets a stale token and 401s (the transient TF400813
            // case); the retry acquires a fresh token and succeeds. Proves the retry
            // re-authenticates rather than replaying the same bearer token.
            const getToken = vi
                .fn<() => Promise<string>>()
                .mockResolvedValueOnce("STALE")
                .mockResolvedValueOnce("FRESH");

            const seenAuth: string[] = [];

            const fetchImpl = vi.fn(async (_url, init) => {
                const auth = (init as RequestInit).headers as Record<string, string>;

                seenAuth.push(auth.Authorization!);

                if (seenAuth.length === 1) {
                    return new Response("no", {
                        status: 401,
                        statusText: "unauth",
                    });
                }

                return jsonResponse({ count: 1, results: [] });
            });

            const client = new AlmSearchRestClient("org", getToken, fetchImpl, noSleep);

            const res = await client.searchCode(REQ, "P");
            expect(res.count).toBe(1);
            expect(getToken).toHaveBeenCalledTimes(2);
            expect(seenAuth).toEqual(["Bearer STALE", "Bearer FRESH"]);
        });

        it("retries a token-provider failure with a fresh acquisition", async () => {
            // getToken throws once (transient host blip) then succeeds; the fetch on
            // the second attempt goes through.
            const getToken = vi
                .fn<() => Promise<string>>()
                .mockRejectedValueOnce(new Error("token boom"))
                .mockResolvedValueOnce("TOK");

            const fetchImpl = vi.fn(async () => jsonResponse({ count: 0 }));

            const client = new AlmSearchRestClient("org", getToken, fetchImpl, noSleep);

            const res = await client.searchCode(REQ, "P");
            expect(res.count).toBe(0);
            expect(getToken).toHaveBeenCalledTimes(2);
            expect(fetchImpl).toHaveBeenCalledTimes(1);
        });

        it("gives up with an auth error when the token never resolves", async () => {
            const getToken = vi.fn(async () => "");

            const client = new AlmSearchRestClient("org", getToken, vi.fn(), noSleep);

            await expect(client.searchCode(REQ, "P")).rejects.toMatchObject({
                kind: "auth",
            });
            // Read budget is 3 attempts; each re-acquires.
            expect(getToken).toHaveBeenCalledTimes(3);
        });

        it("does not retry a terminal 400 despite re-acquiring", async () => {
            const getToken = vi.fn(async () => "TOK");

            const fetchImpl = vi.fn(
                async () => new Response("bad", { status: 400, statusText: "bad" }),
            );

            const client = new AlmSearchRestClient("org", getToken, fetchImpl, noSleep);

            await expect(client.searchCode(REQ, "P")).rejects.toMatchObject({
                kind: "bad-request",
                status: 400,
            });
            expect(fetchImpl).toHaveBeenCalledTimes(1);
            expect(getToken).toHaveBeenCalledTimes(1);
        });
    });
});

describe("createAlmSearchClient", () => {
    it.each([
        { name: "the organization name is missing", options: { getToken: async () => "x" } },
        { name: "the token provider is missing", options: { orgName: "org" } },
    ])("reports no client when $name", ({ options }) => {
        expect(createAlmSearchClient(options)).toMatchObject({ ok: false });
    });

    it("returns a REST-backed client when both inputs are present", () => {
        const r = createAlmSearchClient({
            orgName: "org",
            getToken: async () => "TOK",
        });

        expect(r).toEqual({
            ok: true,
            source: "rest",
            client: expect.any(AlmSearchRestClient),
        });
    });
});

describe("outcomeFromError", () => {
    it("wraps an AlmSearchError into an `unavailable` outcome carrying its kind", () => {
        expect(outcomeFromError(new AlmSearchError("extension-missing", "Not Found", 404))).toEqual(
            {
                kind: "unavailable",
                reason: "extension-missing",
                message: "Not Found",
            },
        );
    });

    it("falls back to `unknown` for unrecognized errors", () => {
        const r = outcomeFromError(new Error("kaboom"));
        expect(r).toEqual({
            kind: "unavailable",
            reason: "unknown",
            message: "kaboom",
        });
    });
});
