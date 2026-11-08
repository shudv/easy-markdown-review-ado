// Tests for the ADO access-token expiry inspection helpers. These decode the
// dead-window signature from the real incident: an AAD token whose embedded ADO
// grant (`xms_attr.*.ado_exp`) lapses ~10 min BEFORE the AAD `exp`, so the
// host serves a token that ADO rejects as the anonymous identity (TF400813).

import { describe, expect, it, vi } from "vitest";

import {
    DEFAULT_GRANT_SKEW_MS,
    classifyAdoGrant,
    detectSessionRefreshing,
    isAdoAuthError,
    isAdoGrantLapsed,
    isSessionRefreshingError,
    parseJwtPayload,
    planSessionRefreshRetry,
    readAdoTokenExpiry,
    SessionRefreshingError,
    withAdoSessionRefreshDetection,
} from "../src/shell/adoAuthToken";
import { withRetry } from "../src/shell/retry";

/** base64url-encode a UTF-8 string (no padding), the JWT segment encoding. */
function b64url(input: string): string {
    return Buffer.from(input, "utf8")
        .toString("base64")
        .replace(/=+$/, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}

/** Build a syntactically valid JWT with the given payload object. */
function makeJwt(payload: Record<string, unknown>): string {
    const header = b64url(JSON.stringify({ typ: "JWT", alg: "RS256" }));
    const body = b64url(JSON.stringify(payload));

    return `${header}.${body}.${"sig".repeat(4)}`;
}

/**
 * A payload mirroring the real trace's claim SHAPE (not its values): a
 * top-level `exp` plus an `xms_attr` map keyed by an opaque host-attribute id
 * whose value carries `ado_exp`. `iat` 65 min ADO grant, 75 min AAD token.
 */
function incidentPayload(iatSeconds: number): Record<string, unknown> {
    return {
        aud: "499b84ac-1321-427f-aa17-267ca6975798",
        iat: iatSeconds,
        nbf: iatSeconds,
        exp: iatSeconds + 75 * 60, // AAD token: 75 min
        xms_attr: {
            rISbSSETf0KqFyZ8ppdXmA: {
                ado_exp: iatSeconds + 65 * 60, // ADO grant: 65 min (10 min earlier)
                ado_scp: "vso.code vso.threads_full vso.identity",
                extn: "easy-markdown-review",
                hostid: "a2fba5bb-e91f-4218-8d9f-3ba6468216b4",
            },
        },
    };
}

describe("parseJwtPayload", () => {
    it("decodes a well-formed JWT payload", () => {
        const token = makeJwt({ exp: 123, sub: "abc" });
        expect(parseJwtPayload(token)).toEqual({ exp: 123, sub: "abc" });
    });

    it("decodes a payload whose encoding uses the URL-safe alphabet", () => {
        // "???>>>~~~" base64-encodes to both `/` and `+`, sent as `_` and `-`.
        const token = makeJwt({ exp: 1, sub: "???>>>~~~" });
        expect(parseJwtPayload(token)).toEqual({ exp: 1, sub: "???>>>~~~" });
    });

    it("decodes multi-byte (non-ASCII) claim values", () => {
        const token = makeJwt({ name: "Шубхам डिवेदी", exp: 1 });
        expect(parseJwtPayload(token)).toMatchObject({ name: "Шубхам डिवेदी" });
    });

    it.each([
        ["empty string", ""],
        ["not a string", 42 as unknown as string],
        ["two segments", "aaa.bbb"],
        ["four segments", "a.b.c.d"],
        ["non-base64 payload", "a.@@@.c"],
        ["array payload", `x.${b64url("[1,2,3]")}.z`],
        ["primitive payload", `x.${b64url('"hi"')}.z`],
        ["non-JSON payload", `x.${b64url("not json")}.z`],
    ])("returns null for %s", (_label, token) => {
        expect(parseJwtPayload(token)).toBeNull();
    });

    it("returns null when atob is unavailable", () => {
        const token = makeJwt({ exp: 123 });
        vi.stubGlobal("atob", undefined);

        try {
            expect(parseJwtPayload(token)).toBeNull();
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe("readAdoTokenExpiry", () => {
    it("reads both AAD exp and embedded ado_exp (ms epoch)", () => {
        const iat = 1_785_819_054;
        const expiry = readAdoTokenExpiry(makeJwt(incidentPayload(iat)));
        expect(expiry.expMs).toBe((iat + 75 * 60) * 1000);
        expect(expiry.adoExpMs).toBe((iat + 65 * 60) * 1000);
        // The dead window is exactly the 10 min gap from the incident.
        expect(expiry.expMs! - expiry.adoExpMs!).toBe(10 * 60 * 1000);
    });

    it.each([
        { name: "listed last", xms_attr: { hostA: { ado_exp: 1500 }, hostB: { ado_exp: 1200 } } },
        { name: "listed first", xms_attr: { hostA: { ado_exp: 1200 }, hostB: { ado_exp: 1500 } } },
    ])("takes the earliest ado_exp across multiple host attributes, $name", ({ xms_attr }) => {
        const token = makeJwt({ exp: 2000, xms_attr });

        expect(readAdoTokenExpiry(token).adoExpMs).toBe(1200 * 1000);
    });

    it.each([
        { name: "absent", payload: { exp: 1000 } },
        { name: "null", payload: { exp: 1000, xms_attr: null } },
    ])("omits ado_exp when xms_attr is $name", ({ payload }) => {
        const expiry = readAdoTokenExpiry(makeJwt(payload));
        expect(expiry.expMs).toBe(1000 * 1000);
        expect(expiry.adoExpMs).toBeUndefined();
    });

    it("omits ado_exp when no host attribute carries one", () => {
        const token = makeJwt({ exp: 1000, xms_attr: { hostA: { scp: "x" } } });
        expect(readAdoTokenExpiry(token).adoExpMs).toBeUndefined();
    });

    it("skips non-object and null xms_attr entries", () => {
        const token = makeJwt({
            exp: 2000,
            xms_attr: {
                bad: "not-an-object",
                empty: null,
                good: { ado_exp: 1200 },
            },
        });

        expect(readAdoTokenExpiry(token).adoExpMs).toBe(1200 * 1000);
    });

    it.each([
        { name: "absent", payload: { sub: "x" } },
        { name: "not a number", payload: { exp: "later" } },
    ])("omits exp when it is $name", ({ payload }) => {
        expect(readAdoTokenExpiry(makeJwt(payload)).expMs).toBeUndefined();
    });

    it("returns empty for an undecodable token", () => {
        expect(readAdoTokenExpiry("garbage")).toEqual({});
    });
});

describe("classifyAdoGrant", () => {
    const iat = 1_785_819_054;
    const token = makeJwt(incidentPayload(iat));
    const adoExpMs = (iat + 65 * 60) * 1000;
    const expMs = (iat + 75 * 60) * 1000;

    it("is live well before the ADO grant expires", () => {
        const now = adoExpMs - 5 * 60_000; // 5 min before ado_exp
        const c = classifyAdoGrant(token, now);
        expect(c.state).toBe("live");
        expect(c.recoverAtMs).toBeUndefined();
    });

    it("is refreshing inside the dead window (ado_exp passed, exp not)", () => {
        const now = adoExpMs + 2 * 60_000; // 2 min into the dead window
        const c = classifyAdoGrant(token, now);
        expect(c.state).toBe("refreshing");
        // Recovery is guaranteed at the AAD exp, when a fresh grant is minted.
        expect(c.recoverAtMs).toBe(expMs);
    });

    // The browser clock may lag ADO's; a grant this close to lapsing is treated as lapsed.
    it("is already refreshing just before ado_exp, within the clock-skew margin", () => {
        const justBefore = adoExpMs - DEFAULT_GRANT_SKEW_MS + 1;
        expect(classifyAdoGrant(token, justBefore).state).toBe("refreshing");
    });

    it("is expired once the AAD token itself (nearly) lapses", () => {
        const now = expMs - DEFAULT_GRANT_SKEW_MS + 1;
        const c = classifyAdoGrant(token, now);
        expect(c.state).toBe("expired");
        expect(c.recoverAtMs).toBe(expMs);
    });

    it("treats a token with no ado_exp as live until its AAD exp", () => {
        const plain = makeJwt({ exp: iat + 75 * 60 });
        expect(classifyAdoGrant(plain, adoExpMs).state).toBe("live");
        expect(classifyAdoGrant(plain, expMs).state).toBe("expired");
    });

    it("is unknown (never blocks) when the token can't be decoded", () => {
        const c = classifyAdoGrant("not-a-jwt", Date.now());
        expect(c.state).toBe("unknown");
        expect(c.recoverAtMs).toBeUndefined();
    });

    it.each([
        { name: "a 30s skew still sees it live", skewMs: 30_000, state: "live" },
        { name: "a 90s skew already sees it refreshing", skewMs: 90_000, state: "refreshing" },
    ])("one minute before ado_exp, $name", ({ skewMs, state }) => {
        expect(classifyAdoGrant(token, adoExpMs - 60_000, skewMs).state).toBe(state);
    });
});

describe("isAdoGrantLapsed", () => {
    it.each([
        ["refreshing", true],
        ["expired", true],
        ["live", false],
        ["unknown", false],
    ] as const)("treats a %s grant as lapsed: %s", (state, lapsed) => {
        expect(isAdoGrantLapsed(state)).toBe(lapsed);
    });
});

describe("isAdoAuthError", () => {
    it.each([
        { name: "a 401 status", error: { status: 401 }, auth: true },
        { name: "a 403 status", error: { status: 403 }, auth: true },
        { name: "a 401 statusCode", error: { statusCode: 401 }, auth: true },
        { name: "a 404 status", error: { status: 404 }, auth: false },
        { name: "a 500 status", error: { status: 500 }, auth: false },
    ])("classifies an error with $name as an auth error: $auth", ({ error, auth }) => {
        expect(isAdoAuthError(error)).toBe(auth);
    });

    const tf400813 =
        "TF400813: The user 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' is not " +
        "authorized to access this resource.";

    it.each([
        { name: "an Error", error: new Error(tf400813) },
        { name: "a bare string", error: tf400813 },
        { name: "an error-shaped object", error: { message: tf400813 } },
    ])("recognises the TF400813 anonymous-identity rejection in $name", ({ error }) => {
        expect(isAdoAuthError(error)).toBe(true);
    });

    it.each([
        { name: "a network failure", error: new Error("network down") },
        { name: "null", error: null },
        { name: "undefined", error: undefined },
    ])("is false for $name", ({ error }) => {
        expect(isAdoAuthError(error)).toBe(false);
    });
});

describe("SessionRefreshingError", () => {
    it("carries the grant state + recover-at and is recognizable", () => {
        const err = new SessionRefreshingError("refreshing", 12_345);
        expect(err).toBeInstanceOf(Error);
        expect(isSessionRefreshingError(err)).toBe(true);
        expect(err.grantState).toBe("refreshing");
        expect(err.recoverAtMs).toBe(12_345);
        expect(err.name).toBe("SessionRefreshingError");
    });

    it("explains the refresh in its message, which load errors show the reader", () => {
        expect(new SessionRefreshingError("refreshing").message).toBe(
            "Azure DevOps session is refreshing (access token grant expired); waiting for the host to issue a new token.",
        );
    });

    it.each([
        { name: "a plain Error", error: new Error("nope") },
        { name: "a string", error: "nope" },
    ])("is distinguishable from $name", ({ error }) => {
        expect(isSessionRefreshingError(error)).toBe(false);
    });
});

describe("planSessionRefreshRetry", () => {
    it("waits until recoverAtMs (+buffer) when known", () => {
        const now = 1_000_000;

        const plan = planSessionRefreshRetry({
            recoverAtMs: now + 120_000,
            nowMs: now,
            attempt: 1,
        });

        expect(plan.giveUp).toBe(false);
        expect(plan.delayMs).toBe(120_000 + 2_000);
    });

    it("clamps a past recoverAtMs up to the minimum delay (expired case)", () => {
        const now = 1_000_000;

        const plan = planSessionRefreshRetry({
            recoverAtMs: now - 5_000, // already past
            nowMs: now,
            attempt: 1,
            minDelayMs: 3_000,
        });

        expect(plan.delayMs).toBe(3_000);
    });

    it("caps an absurdly distant recoverAtMs at the ceiling", () => {
        const now = 0;

        const plan = planSessionRefreshRetry({
            recoverAtMs: 60 * 60_000, // 1 hour out
            nowMs: now,
            attempt: 1,
            ceilingMs: 11 * 60_000,
        });

        expect(plan.delayMs).toBe(11 * 60_000);
    });

    it.each([
        [1, 3_000],
        [2, 6_000],
        [3, 12_000],
    ])(
        "backs off exponentially when recoverAtMs is unknown: attempt %i waits %ims",
        (attempt, delayMs) => {
            expect(planSessionRefreshRetry({ nowMs: 0, minDelayMs: 3_000, attempt }).delayMs).toBe(
                delayMs,
            );
        },
    );

    it("still retries on the last allowed attempt", () => {
        expect(
            planSessionRefreshRetry({ recoverAtMs: 100, nowMs: 0, attempt: 6, maxAttempts: 6 })
                .giveUp,
        ).toBe(false);
    });

    it("gives up after maxAttempts", () => {
        const plan = planSessionRefreshRetry({
            recoverAtMs: 100,
            nowMs: 0,
            attempt: 7,
            maxAttempts: 6,
        });

        expect(plan.giveUp).toBe(true);
    });
});

describe("detectSessionRefreshing", () => {
    const iat = 1_785_819_054;
    const deadToken = makeJwt(incidentPayload(iat));
    const adoExpMs = (iat + 65 * 60) * 1000;
    const expMs = (iat + 75 * 60) * 1000;
    const deadNow = adoExpMs + 2 * 60_000;
    const liveNow = adoExpMs - 5 * 60_000;
    const auth401 = Object.assign(new Error("Unauthorized"), { status: 401 });

    it("passes a SessionRefreshingError through without reading the token", async () => {
        const original = new SessionRefreshingError("refreshing", 999);
        const getToken = vi.fn();
        await expect(detectSessionRefreshing(original, getToken, deadNow)).resolves.toBe(original);
        expect(getToken).not.toHaveBeenCalled();
    });

    it("returns null for a non-auth error without reading the token", async () => {
        const getToken = vi.fn();
        const err = Object.assign(new Error("server blew up"), { status: 500 });
        await expect(detectSessionRefreshing(err, getToken, deadNow)).resolves.toBeNull();
        expect(getToken).not.toHaveBeenCalled();
    });

    it("converts a 401 to SessionRefreshingError when the token is dead", async () => {
        const getToken = vi.fn().mockResolvedValue(deadToken);

        const result = await detectSessionRefreshing(auth401, getToken, deadNow);

        expect(result).toBeInstanceOf(SessionRefreshingError);
        expect(result?.grantState).toBe("refreshing");
        expect(result?.recoverAtMs).toBe(expMs);
    });

    it("leaves a genuine 401 alone when the token is still live", async () => {
        const getToken = vi.fn().mockResolvedValue(deadToken);
        await expect(detectSessionRefreshing(auth401, getToken, liveNow)).resolves.toBeNull();
    });

    it("converts a TF400813 rejection when the token is dead", async () => {
        const err = new Error(
            "TF400813: The user 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' is not " +
                "authorized to access this resource.",
        );

        const getToken = vi.fn().mockResolvedValue(deadToken);
        const result = await detectSessionRefreshing(err, getToken, deadNow);
        expect(result?.grantState).toBe("refreshing");
    });

    it("returns null when the token can't be read (classifies unknown)", async () => {
        const getToken = vi.fn().mockRejectedValue(new Error("no token"));
        await expect(detectSessionRefreshing(auth401, getToken, deadNow)).resolves.toBeNull();
    });
});

describe("withAdoSessionRefreshDetection", () => {
    const iat = 1_785_819_054;
    const token = makeJwt(incidentPayload(iat));
    const adoExpMs = (iat + 65 * 60) * 1000;
    const deadNow = adoExpMs + 2 * 60_000;
    const liveNow = adoExpMs - 5 * 60_000;
    const auth401 = Object.assign(new Error("Unauthorized"), { status: 401 });

    it("does not inspect a dead-looking token before a successful operation", async () => {
        const op = vi.fn().mockResolvedValue("ok");
        const getToken = vi.fn().mockResolvedValue(token);
        await expect(withAdoSessionRefreshDetection(op, getToken)).resolves.toBe("ok");
        expect(op).toHaveBeenCalledOnce();
        expect(getToken).not.toHaveBeenCalled();
    });

    it("stops write retries after one confirmed dead-window rejection", async () => {
        const op = vi.fn().mockRejectedValue(auth401);
        const getToken = vi.fn().mockResolvedValue(token);
        await expect(
            withRetry(() => withAdoSessionRefreshDetection(op, getToken, () => deadNow), {
                mode: "write",
                sleep: vi.fn(),
            }),
        ).rejects.toBeInstanceOf(SessionRefreshingError);
        expect(op).toHaveBeenCalledOnce();
        expect(getToken).toHaveBeenCalledOnce();
    });

    it("stops read retries after one confirmed dead-window rejection", async () => {
        const op = vi.fn().mockRejectedValue(auth401);
        const getToken = vi.fn().mockResolvedValue(token);
        await expect(
            withRetry(() => withAdoSessionRefreshDetection(op, getToken, () => deadNow), {
                mode: "read",
                sleep: vi.fn(),
            }),
        ).rejects.toBeInstanceOf(SessionRefreshingError);
        expect(op).toHaveBeenCalledOnce();
        expect(getToken).toHaveBeenCalledOnce();
    });

    it("preserves a live-token 401 so write retry can recover", async () => {
        const op = vi.fn().mockRejectedValueOnce(auth401).mockResolvedValue("ok");

        const getToken = vi.fn().mockResolvedValue(token);
        await expect(
            withRetry(() => withAdoSessionRefreshDetection(op, getToken, () => liveNow), {
                mode: "write",
                sleep: vi.fn(),
                random: () => 0,
            }),
        ).resolves.toBe("ok");
        expect(op).toHaveBeenCalledTimes(2);
        expect(getToken).toHaveBeenCalledOnce();
    }, 10_000);

    // A slow call can start while the grant is live and fail after it lapsed.
    it("judges the grant at the moment the token is read, not when the call started", async () => {
        let clock = liveNow;
        const op = vi.fn().mockRejectedValue(auth401);

        const getToken = vi.fn().mockImplementation(async () => {
            clock = deadNow;

            return token;
        });

        await expect(
            withAdoSessionRefreshDetection(op, getToken, () => clock),
        ).rejects.toBeInstanceOf(SessionRefreshingError);
    });
});
