// Tests for the typed ALM Search REST wrapper. Uses an injected fake
// `fetch` so we can pin URL composition, headers, body, and the full
// error-mapping table without a real network.

import { describe, expect, it, vi } from "vitest";

import {
  AlmSearchRestClient,
  createAlmSearchClient,
  isAlmSearchError,
  outcomeFromError,
  statusToKind,
  type AlmSearchError,
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
  it("detects shaped errors", () => {
    const e: AlmSearchError = { kind: "auth", status: 401 };
    expect(isAlmSearchError(e)).toBe(true);
  });

  it("rejects plain Errors and non-objects", () => {
    expect(isAlmSearchError(new Error("nope"))).toBe(false);
    expect(isAlmSearchError(null)).toBe(false);
    expect(isAlmSearchError("kind")).toBe(false);
    expect(isAlmSearchError({})).toBe(false);
  });

  it("rejects an object whose `kind` is not a string", () => {
    // `kind` is present but the wrong type — not a real AlmSearchError.
    expect(isAlmSearchError({ kind: 123 })).toBe(false);
  });
});

describe("AlmSearchRestClient", () => {
  it("composes the URL with encoded org + project and sends the request body", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ count: 0, results: [] }),
    );
    const client = new AlmSearchRestClient(
      "my org",
      async () => "TOK",
      fetchImpl,
    );
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

  it("propagates an AbortSignal through to fetch", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect((init as RequestInit).signal).toBeDefined();
      return jsonResponse({});
    });
    const client = new AlmSearchRestClient("org", async () => "TOK", fetchImpl);
    const ac = new AbortController();
    await client.searchCode(REQ, "P", ac.signal);
  });

  it("preserves an AbortError instead of reporting it as a network failure", async () => {
    const ac = new AbortController();
    const fetchImpl = vi.fn(async () => {
      ac.abort();
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    });
    const client = new AlmSearchRestClient(
      "org",
      async () => "TOK",
      fetchImpl,
      noSleep,
    );
    await expect(client.searchCode(REQ, "P", ac.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("falls back to a generic message when the failure cannot be stringified", async () => {
    // A non-Error rejection whose String() coercion itself throws — errMsg
    // must still produce a usable message instead of propagating the throw.
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
    const client = new AlmSearchRestClient(
      "org",
      async () => "",
      vi.fn(),
      noSleep,
    );
    await expect(client.searchCode(REQ, "P")).rejects.toMatchObject({
      kind: "auth",
    });
  });

  it("classifies fetch-thrown errors as `network`", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("offline");
    });
    const client = new AlmSearchRestClient(
      "org",
      async () => "TOK",
      fetchImpl,
      noSleep,
    );
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
  ] as const)(
    "maps a non-OK %i response to a `%s` AlmSearchError",
    async (status, kind) => {
      const fetchImpl = vi.fn(
        async () =>
          new Response("err", {
            status,
            statusText: `status ${status}`,
          }),
      );
      const client = new AlmSearchRestClient(
        "org",
        async () => "TOK",
        fetchImpl,
        noSleep,
      );
      await expect(client.searchCode(REQ, "P")).rejects.toMatchObject({
        kind,
        status,
      });
    },
  );

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
          return new Response("no", { status: 401, statusText: "unauth" });
        }
        return jsonResponse({ count: 1, results: [] });
      });
      const client = new AlmSearchRestClient(
        "org",
        getToken,
        fetchImpl,
        noSleep,
      );
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
      const client = new AlmSearchRestClient(
        "org",
        getToken,
        fetchImpl,
        noSleep,
      );
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
      const client = new AlmSearchRestClient(
        "org",
        getToken,
        fetchImpl,
        noSleep,
      );
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
  it("returns `no-config` when org name is missing", () => {
    const r = createAlmSearchClient({ getToken: async () => "x" });
    expect(r.ok).toBe(false);
  });

  it("returns `no-config` when the token provider is missing", () => {
    const r = createAlmSearchClient({ orgName: "org" });
    expect(r.ok).toBe(false);
  });

  it("returns a REST-backed client when both inputs are present", () => {
    const r = createAlmSearchClient({
      orgName: "org",
      getToken: async () => "TOK",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("rest");
      expect(r.client).toBeInstanceOf(AlmSearchRestClient);
    }
  });
});

describe("outcomeFromError", () => {
  it("wraps an AlmSearchError into an `unavailable` outcome carrying its kind", () => {
    expect(
      outcomeFromError({ kind: "extension-missing", status: 404 }),
    ).toEqual({
      kind: "unavailable",
      reason: "extension-missing",
    });
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
