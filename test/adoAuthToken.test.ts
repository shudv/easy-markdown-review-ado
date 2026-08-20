// Tests for the ADO access-token expiry inspection helpers. These decode the
// dead-window signature from the real incident: an AAD token whose embedded ADO
// grant (`xms_attr.*.ado_exp`) lapses ~10 min BEFORE the AAD `exp`, so the
// host serves a token that ADO rejects as the anonymous identity (TF400813).

import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_GRANT_SKEW_MS,
  classifyAdoGrant,
  detectSessionRefreshing,
  ensureAdoSessionLive,
  isAdoAuthError,
  isAdoGrantLapsed,
  isSessionRefreshingError,
  parseJwtPayload,
  planSessionRefreshRetry,
  readAdoTokenExpiry,
  SessionRefreshingError,
} from "../src/shell/adoAuthToken";

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

  it("takes the earliest ado_exp across multiple host attributes", () => {
    const token = makeJwt({
      exp: 2000,
      xms_attr: {
        hostA: { ado_exp: 1500 },
        hostB: { ado_exp: 1200 },
      },
    });
    expect(readAdoTokenExpiry(token).adoExpMs).toBe(1200 * 1000);
  });

  it("omits ado_exp when xms_attr is absent", () => {
    const expiry = readAdoTokenExpiry(makeJwt({ exp: 1000 }));
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
      xms_attr: { bad: "not-an-object", empty: null, good: { ado_exp: 1200 } },
    });
    expect(readAdoTokenExpiry(token).adoExpMs).toBe(1200 * 1000);
  });

  it("omits exp when absent or non-numeric", () => {
    expect(readAdoTokenExpiry(makeJwt({ sub: "x" })).expMs).toBeUndefined();
    expect(readAdoTokenExpiry(makeJwt({ exp: "later" })).expMs).toBeUndefined();
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

  it("flips to refreshing skewMs BEFORE ado_exp (clock-skew guard)", () => {
    const justBefore = adoExpMs - DEFAULT_GRANT_SKEW_MS + 1;
    expect(classifyAdoGrant(token, justBefore).state).toBe("refreshing");
    const wellBefore = adoExpMs - DEFAULT_GRANT_SKEW_MS - 1_000;
    expect(classifyAdoGrant(token, wellBefore).state).toBe("live");
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

  it("honors a custom skew", () => {
    const now = adoExpMs - 60_000; // 1 min before ado_exp
    expect(classifyAdoGrant(token, now, 30_000).state).toBe("live");
    expect(classifyAdoGrant(token, now, 90_000).state).toBe("refreshing");
  });
});

describe("isAdoGrantLapsed", () => {
  it("is true only for refreshing / expired", () => {
    expect(isAdoGrantLapsed("refreshing")).toBe(true);
    expect(isAdoGrantLapsed("expired")).toBe(true);
    expect(isAdoGrantLapsed("live")).toBe(false);
    expect(isAdoGrantLapsed("unknown")).toBe(false);
  });
});

describe("isAdoAuthError", () => {
  it("matches HTTP 401 / 403 shapes", () => {
    expect(isAdoAuthError({ status: 401 })).toBe(true);
    expect(isAdoAuthError({ status: 403 })).toBe(true);
    expect(isAdoAuthError({ statusCode: 401 })).toBe(true);
    expect(isAdoAuthError({ status: 404 })).toBe(false);
    expect(isAdoAuthError({ status: 500 })).toBe(false);
  });

  it("matches the TF400813 anonymous-identity rejection message", () => {
    const msg =
      "TF400813: The user 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' is not " +
      "authorized to access this resource.";
    expect(isAdoAuthError(new Error(msg))).toBe(true);
    expect(isAdoAuthError(msg)).toBe(true);
    expect(isAdoAuthError({ message: msg })).toBe(true);
  });

  it("is false for unrelated errors", () => {
    expect(isAdoAuthError(new Error("network down"))).toBe(false);
    expect(isAdoAuthError(null)).toBe(false);
    expect(isAdoAuthError(undefined)).toBe(false);
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

  it("is distinguishable from a plain Error", () => {
    expect(isSessionRefreshingError(new Error("nope"))).toBe(false);
    expect(isSessionRefreshingError("nope")).toBe(false);
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

  it("backs off exponentially when recoverAtMs is unknown", () => {
    const base = { nowMs: 0, minDelayMs: 3_000 };
    expect(planSessionRefreshRetry({ ...base, attempt: 1 }).delayMs).toBe(
      3_000,
    );
    expect(planSessionRefreshRetry({ ...base, attempt: 2 }).delayMs).toBe(
      6_000,
    );
    expect(planSessionRefreshRetry({ ...base, attempt: 3 }).delayMs).toBe(
      12_000,
    );
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

// The glue the PR-tab boot uses. Injected `getToken` / `nowMs` keep these
// SDK-free, so the dead-window wiring is validated without a live host — the
// same injected-provider seam the repo uses elsewhere (e.g. almSearch).
describe("ensureAdoSessionLive", () => {
  const iat = 1_785_819_054;
  const token = makeJwt(incidentPayload(iat));
  const adoExpMs = (iat + 65 * 60) * 1000;
  const expMs = (iat + 75 * 60) * 1000;

  it("resolves without throwing for a live token", async () => {
    const getToken = vi.fn().mockResolvedValue(token);
    await expect(
      ensureAdoSessionLive(getToken, adoExpMs - 5 * 60_000),
    ).resolves.toBeUndefined();
    expect(getToken).toHaveBeenCalledOnce();
  });

  it("throws SessionRefreshingError inside the dead window (recover at exp)", async () => {
    const getToken = vi.fn().mockResolvedValue(token);
    await expect(
      ensureAdoSessionLive(getToken, adoExpMs + 2 * 60_000),
    ).rejects.toMatchObject({
      name: "SessionRefreshingError",
      grantState: "refreshing",
      recoverAtMs: expMs,
    });
  });

  it("throws (expired) once the AAD token itself has lapsed", async () => {
    const getToken = vi.fn().mockResolvedValue(token);
    await expect(
      ensureAdoSessionLive(getToken, expMs + 1_000),
    ).rejects.toMatchObject({ grantState: "expired" });
  });

  it("resolves (defers to the real call) when getToken rejects", async () => {
    const getToken = vi.fn().mockRejectedValue(new Error("no token"));
    await expect(
      ensureAdoSessionLive(getToken, expMs + 1_000),
    ).resolves.toBeUndefined();
  });

  it("resolves for an undecodable token (never blocks on a parse miss)", async () => {
    const getToken = vi.fn().mockResolvedValue("garbage");
    await expect(
      ensureAdoSessionLive(getToken, Date.now()),
    ).resolves.toBeUndefined();
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
    await expect(
      detectSessionRefreshing(original, getToken, deadNow),
    ).resolves.toBe(original);
    expect(getToken).not.toHaveBeenCalled();
  });

  it("returns null for a non-auth error without reading the token", async () => {
    const getToken = vi.fn();
    const err = Object.assign(new Error("server blew up"), { status: 500 });
    await expect(
      detectSessionRefreshing(err, getToken, deadNow),
    ).resolves.toBeNull();
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
    await expect(
      detectSessionRefreshing(auth401, getToken, liveNow),
    ).resolves.toBeNull();
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
    await expect(
      detectSessionRefreshing(auth401, getToken, deadNow),
    ).resolves.toBeNull();
  });
});
