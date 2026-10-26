// Tests for the shared ADO session monitor: the dead-window spell lifecycle,
// early resume on host re-mint, held writes, diagnostics, and the boot
// auto-reload guard.
//
// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTO_RELOAD_COOLDOWN_MS,
  AUTO_RELOAD_STORAGE_KEY,
  AdoSessionMonitor,
  HELD_WRITE_MAX_WAIT_MS,
  SESSION_POLL_MS,
  SESSION_SLOW_AFTER_MS,
  SESSION_SLOW_POLL_MS,
  adoSession,
  AUTO_RELOAD_RESULT_WINDOW_MS,
  autoReloadAllowed,
  claimAutoReload,
  followsRecentAutoReload,
  sessionStorageOrUndefined,
  useAdoSession,
} from "../src/shell/adoSession";
import { SessionRefreshingError } from "../src/shell/adoAuthToken";

const trackMock = vi.fn();
const trackUserFacingErrorMock = vi.fn();
vi.mock("../src/telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/telemetry")>();
  return {
    ...actual,
    track: (...args: unknown[]) => trackMock(...args),
    trackUserFacingError: (...args: unknown[]) =>
      trackUserFacingErrorMock(...args),
  };
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function b64url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/** A host token whose ADO grant ends at `adoExpMs` and AAD token at `expMs`. */
function token(adoExpMs: number, expMs: number): string {
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "RS256" }));
  const body = b64url(
    JSON.stringify({
      exp: Math.floor(expMs / 1000),
      xms_attr: { host: { ado_exp: Math.floor(adoExpMs / 1000) } },
    }),
  );
  return `${header}.${body}.sig`;
}

const T0 = Date.UTC(2026, 9, 16, 12, 0, 0);
// The rejected token: ADO grant lapsed 1 min ago, AAD `exp` in 9 min.
const DEAD = token(T0 - 60_000, T0 + 9 * 60_000);
// A freshly minted token: both expiries an hour away.
const FRESH = token(T0 + 65 * 60_000, T0 + 75 * 60_000);

const refreshing = () =>
  new SessionRefreshingError("refreshing", T0 + 9 * 60_000);

function eventsNamed(phase: "start" | "end") {
  return trackMock.mock.calls
    .map(
      ([e]) =>
        e as {
          name: string;
          properties: Record<string, unknown>;
          measurements: Record<string, number>;
        },
    )
    .filter(
      (e) => e.name === "auth.sessionRefresh" && e.properties.phase === phase,
    );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  trackMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AdoSessionMonitor — entering a spell", () => {
  it("ignores anything that is not a confirmed dead-window rejection", () => {
    const m = new AdoSessionMonitor();
    expect(m.report(new Error("TF400813"), "poll")).toBe(false);
    expect(m.report({ status: 401 }, "poll")).toBe(false);
    expect(m.getSnapshot().state).toBe("live");
    expect(trackMock).not.toHaveBeenCalled();
  });

  it("enters refreshing once per spell and emits one start event", () => {
    const m = new AdoSessionMonitor();
    const listener = vi.fn();
    m.subscribe(listener);
    expect(m.report(refreshing(), "poll")).toBe(true);
    expect(m.report(refreshing(), "write")).toBe(true);

    expect(m.getSnapshot().state).toBe("refreshing");
    expect(listener).toHaveBeenCalledTimes(1);
    const [start] = eventsNamed("start");
    expect(eventsNamed("start")).toHaveLength(1);
    expect(start!.properties).toEqual({
      phase: "start",
      trigger: "poll",
      grantState: "refreshing",
    });
    expect(start!.measurements).toEqual({ secsUntilExpAtStart: 540 });
  });

  it("omits expiry timing when the error carries no recoverAtMs", () => {
    const m = new AdoSessionMonitor();
    m.report(new SessionRefreshingError("expired"), "boot");
    expect(eventsNamed("start")[0]!.measurements).toEqual({});
    m.noteSuccess(Date.now());
    expect(eventsNamed("end")[0]!.measurements).toEqual({
      durationSec: 0,
      heldWrites: 0,
    });
  });

  it("stops notifying an unsubscribed recovery listener", () => {
    const m = new AdoSessionMonitor();
    const listener = vi.fn();
    const off = m.onRecovered(listener);
    off();
    m.report(refreshing(), "poll");
    m.noteSuccess(Date.now());
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("AdoSessionMonitor — early resume", () => {
  // The point of early resume: production poll bursts end ~4.4 min in, long
  // before the ~10 min AAD `exp` callers used to wait for.
  it("flips back to live as soon as the host hands out a fresh token", async () => {
    let current = DEAD;
    const m = new AdoSessionMonitor();
    m.configure({ getToken: async () => current });
    const recovered = vi.fn();
    m.onRecovered(recovered);

    m.report(refreshing(), "poll");
    await vi.advanceTimersByTimeAsync(0);
    expect(m.getSnapshot().state).toBe("refreshing");

    await vi.advanceTimersByTimeAsync(3 * SESSION_POLL_MS);
    expect(m.getSnapshot().state).toBe("refreshing");

    current = FRESH;
    await vi.advanceTimersByTimeAsync(SESSION_POLL_MS);
    expect(m.getSnapshot().state).toBe("live");
    expect(recovered).toHaveBeenCalledOnce();

    const [end] = eventsNamed("end");
    expect(end!.properties).toMatchObject({
      outcome: "remint",
      trigger: "poll",
    });
    expect(end!.measurements).toMatchObject({
      durationSec: 40,
      secsUntilExpAtStart: 540,
      secsBeforeExpAtEnd: 500,
      secsSinceAdoExpAtStart: 60,
      heldWrites: 0,
    });
  });

  it("treats an undecodable token as live rather than holding the app hostage", async () => {
    const m = new AdoSessionMonitor();
    m.configure({ getToken: async () => "not-a-jwt" });
    m.report(refreshing(), "boot");
    await vi.advanceTimersByTimeAsync(0);
    expect(m.getSnapshot().state).toBe("live");
  });

  it("keeps watching when the token read fails or no reader is wired", async () => {
    const m = new AdoSessionMonitor();
    m.report(refreshing(), "poll");
    await vi.advanceTimersByTimeAsync(SESSION_POLL_MS);
    expect(m.getSnapshot().state).toBe("refreshing");

    let fail = true;
    m.configure({
      getToken: async () => {
        if (fail) throw new Error("host busy");
        return FRESH;
      },
    });
    await vi.advanceTimersByTimeAsync(SESSION_POLL_MS);
    expect(m.getSnapshot().state).toBe("refreshing");
    fail = false;
    await vi.advanceTimersByTimeAsync(SESSION_POLL_MS);
    expect(m.getSnapshot().state).toBe("live");
  });

  it("slows the token polling once a spell outlasts the widest dead window", async () => {
    const getToken = vi.fn(async () => DEAD);
    const m = new AdoSessionMonitor();
    m.configure({ getToken });
    m.report(refreshing(), "poll");
    await vi.advanceTimersByTimeAsync(SESSION_SLOW_AFTER_MS);
    const before = getToken.mock.calls.length;
    await vi.advanceTimersByTimeAsync(SESSION_SLOW_POLL_MS - 1);
    // At most the one fast poll still pending from before the threshold.
    expect(getToken.mock.calls.length - before).toBeLessThanOrEqual(1);
    const mid = getToken.mock.calls.length;
    await vi.advanceTimersByTimeAsync(SESSION_SLOW_POLL_MS);
    expect(getToken.mock.calls.length - mid).toBe(1);
  });

  it("ends the spell when any ADO call succeeds", () => {
    const m = new AdoSessionMonitor();
    m.noteSuccess(Date.now());
    expect(trackMock).not.toHaveBeenCalled();
    m.report(refreshing(), "poll");
    m.noteSuccess(Date.now());
    expect(m.getSnapshot().state).toBe("live");
    expect(eventsNamed("end")[0]!.properties.outcome).toBe("success");
  });

  it("discards a token read that lands after the spell already ended", async () => {
    let release!: (t: string) => void;
    const m = new AdoSessionMonitor();
    m.configure({ getToken: () => new Promise<string>((r) => (release = r)) });
    m.report(refreshing(), "poll");
    await vi.advanceTimersByTimeAsync(0);
    m.noteSuccess(Date.now());
    release(DEAD);
    await vi.advanceTimersByTimeAsync(SESSION_POLL_MS);
    expect(m.getSnapshot().state).toBe("live");
    expect(eventsNamed("end")).toHaveLength(1);
  });
});

describe("AdoSessionMonitor — stale successes", () => {
  // Review finding: a slow read authenticated before the grant lapsed can
  // succeed after a newer write was rejected; it must not end the spell (and
  // release the held write into a second, doomed attempt).
  it("ignores success from a request that started before the spell", async () => {
    const m = new AdoSessionMonitor();
    const startedBefore = Date.now();
    await vi.advanceTimersByTimeAsync(1_000);
    m.report(refreshing(), "write");
    m.noteSuccess(startedBefore);
    expect(m.getSnapshot().state).toBe("refreshing");
    m.noteSuccess(Date.now());
    expect(m.getSnapshot().state).toBe("live");
  });
});

describe("AdoSessionMonitor — waitUntilLive", () => {
  it("resolves immediately when live", async () => {
    await expect(new AdoSessionMonitor().waitUntilLive(1)).resolves.toBe(true);
  });

  it("resolves true on recovery and false on timeout", async () => {
    const m = new AdoSessionMonitor();
    m.report(refreshing(), "poll");
    const timedOut = m.waitUntilLive(1_000);
    const recovered = m.waitUntilLive(60_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(timedOut).resolves.toBe(false);
    m.noteSuccess(Date.now());
    await expect(recovered).resolves.toBe(true);
  });
});

describe("AdoSessionMonitor — held writes", () => {
  it("passes a successful write straight through", async () => {
    const m = new AdoSessionMonitor();
    await expect(m.holdWrite(async () => "ok")).resolves.toBe("ok");
  });

  it("rethrows a failure that is not the dead window without holding", async () => {
    const m = new AdoSessionMonitor();
    const boom = Object.assign(new Error("conflict"), { status: 409 });
    await expect(m.holdWrite(() => Promise.reject(boom))).rejects.toBe(boom);
    expect(m.getSnapshot()).toMatchObject({ state: "live", heldWrites: 0 });
  });

  // Production: 22 sessions/week had a comment fail with "reload the page".
  it("holds a dead-window write and posts it once the host re-mints", async () => {
    let current = DEAD;
    const m = new AdoSessionMonitor();
    m.configure({ getToken: async () => current });
    const attempt = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(refreshing())
      .mockResolvedValueOnce("posted");

    const write = m.holdWrite(attempt);
    await vi.advanceTimersByTimeAsync(0);
    expect(m.getSnapshot()).toMatchObject({
      state: "refreshing",
      heldWrites: 1,
    });
    expect(attempt).toHaveBeenCalledOnce();

    current = FRESH;
    await vi.advanceTimersByTimeAsync(SESSION_POLL_MS);
    await expect(write).resolves.toBe("posted");
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(m.getSnapshot()).toMatchObject({ state: "live", heldWrites: 0 });
    expect(eventsNamed("end")[0]!.measurements.heldWrites).toBe(1);
  });

  it("fails with the original error when the hold times out", async () => {
    const m = new AdoSessionMonitor();
    m.configure({ getToken: async () => DEAD });
    const err = refreshing();
    const attempt = vi.fn(() => Promise.reject(err));
    const write = m.holdWrite(attempt, 30_000);
    const assertion = expect(write).rejects.toBe(err);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(attempt).toHaveBeenCalledOnce();
    expect(m.getSnapshot().heldWrites).toBe(0);
  });

  it("defaults the hold to HELD_WRITE_MAX_WAIT_MS", async () => {
    const m = new AdoSessionMonitor();
    const write = m.holdWrite(() => Promise.reject(refreshing()));
    let settled = false;
    write.catch(() => (settled = true));
    await vi.advanceTimersByTimeAsync(HELD_WRITE_MAX_WAIT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  it("retries only once: a second rejection fails and starts a new spell", async () => {
    const m = new AdoSessionMonitor();
    const second = refreshing();
    const attempt = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(refreshing())
      .mockRejectedValueOnce(second);
    const write = m.holdWrite(attempt);
    await vi.advanceTimersByTimeAsync(0);
    m.noteSuccess(Date.now());
    await expect(write).rejects.toBe(second);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(m.getSnapshot().state).toBe("refreshing");
  });
});

describe("AdoSessionMonitor — host reload and page hide", () => {
  it("is a no-op without a wired reload", async () => {
    const m = new AdoSessionMonitor();
    m.report(refreshing(), "boot");
    await expect(m.reloadHost("user")).resolves.toBe(false);
    expect(m.getSnapshot()).toMatchObject({
      state: "refreshing",
      canReload: false,
    });
  });

  // Review finding: a reload is only *requested* — the host still serves the
  // dead token — so it must not release held writes or resume anything.
  it("closes the spell for telemetry on reload without signalling recovery", async () => {
    const reloadHost = vi.fn();
    const recovered = vi.fn();
    const m = new AdoSessionMonitor();
    m.configure({ reloadHost });
    m.onRecovered(recovered);
    expect(m.getSnapshot().canReload).toBe(true);
    m.report(refreshing(), "boot");
    await expect(m.reloadHost("auto")).resolves.toBe(true);
    expect(reloadHost).toHaveBeenCalledOnce();
    expect(eventsNamed("end")[0]!.properties.outcome).toBe("reload-auto");
    expect(m.getSnapshot().state).toBe("refreshing");
    expect(recovered).not.toHaveBeenCalled();

    // A second reload, and the eventual real recovery, add no more end events.
    await m.reloadHost("user");
    expect(reloadHost).toHaveBeenCalledTimes(2);
    m.noteSuccess(Date.now());
    expect(m.getSnapshot().state).toBe("live");
    expect(recovered).toHaveBeenCalledOnce();
    expect(eventsNamed("end")).toHaveLength(1);

    m.report(refreshing(), "write");
    await m.reloadHost("user");
    expect(eventsNamed("end")[1]!.properties.outcome).toBe("reload-user");
  });

  it("keeps a held write held through a reload request", async () => {
    const m = new AdoSessionMonitor();
    m.configure({ reloadHost: vi.fn() });
    const attempt = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(refreshing())
      .mockResolvedValueOnce("posted");
    const write = m.holdWrite(attempt);
    await vi.advanceTimersByTimeAsync(0);
    await m.reloadHost("user");
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledOnce();
    expect(m.getSnapshot().heldWrites).toBe(1);
    m.noteSuccess(Date.now());
    await expect(write).resolves.toBe("posted");
  });

  // Review finding: failed reloads were swallowed with no signal at all.
  it("reports a reload that throws or rejects, and says it didn't happen", async () => {
    const m = new AdoSessionMonitor();
    // (Not "boot": the page-hide test below counts open boot spells.)
    m.report(refreshing(), "poll");
    m.configure({
      reloadHost: () => {
        throw new Error("no nav service");
      },
    });
    await expect(m.reloadHost("user")).resolves.toBe(false);
    expect(trackUserFacingErrorMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: "AdoSession.reloadHost",
        operation: "host-reload",
        impact: "action-failed",
      }),
    );
    m.configure({ reloadHost: () => Promise.reject(new Error("denied")) });
    await expect(m.reloadHost("auto")).resolves.toBe(false);
    expect(trackUserFacingErrorMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ impact: "degraded" }),
    );
    // The spell is still open and was not closed out as a reload.
    expect(m.getSnapshot().state).toBe("refreshing");
    expect(eventsNamed("end")).toHaveLength(0);
  });

  it("records 'left' when the page goes away mid-spell, but keeps the spell open", async () => {
    let current = DEAD;
    const m = new AdoSessionMonitor();
    m.configure({ getToken: async () => current });
    m.configure({ getToken: async () => current });
    m.report(refreshing(), "boot");
    // Other monitors in this file also listen on the shared jsdom window, so
    // count only this spell's events.
    const bootEnds = () =>
      eventsNamed("end").filter((e) => e.properties.trigger === "boot");
    window.dispatchEvent(new Event("pagehide"));
    expect(bootEnds()).toHaveLength(1);
    expect(bootEnds()[0]!.properties.outcome).toBe("left");
    // `pagehide` also fires entering the back/forward cache; a restored page
    // keeps watching and still recovers.
    expect(m.getSnapshot().state).toBe("refreshing");
    m.notePageHide();
    current = FRESH;
    await vi.advanceTimersByTimeAsync(SESSION_POLL_MS);
    expect(m.getSnapshot().state).toBe("live");
    expect(bootEnds()).toHaveLength(1);
  });
});

describe("useAdoSession", () => {
  it("re-renders with the monitor's snapshot", () => {
    const m = new AdoSessionMonitor();
    const seen: string[] = [];
    function Probe(): null {
      seen.push(useAdoSession(m).state);
      return null;
    }
    const el = document.createElement("div");
    const root = createRoot(el);
    act(() => root.render(React.createElement(Probe)));
    act(() => {
      m.report(refreshing(), "poll");
    });
    act(() => m.noteSuccess(Date.now()));
    act(() => root.unmount());
    expect(seen).toEqual(["live", "refreshing", "live"]);
  });

  it("defaults to the app-wide monitor", () => {
    let state: string | undefined;
    function Probe(): null {
      state = useAdoSession().state;
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(React.createElement(Probe)));
    expect(state).toBe(adoSession.getSnapshot().state);
    act(() => root.unmount());
  });
});

describe("claimAutoReload", () => {
  function memoryStorage(initial?: string) {
    const map = new Map<string, string>();
    if (initial !== undefined) map.set(AUTO_RELOAD_STORAGE_KEY, initial);
    return {
      map,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
  }

  it("allows the first reload and records it", () => {
    const s = memoryStorage();
    expect(claimAutoReload(s, 5_000)).toBe(true);
    expect(s.map.get(AUTO_RELOAD_STORAGE_KEY)).toBe("5000");
  });

  it("refuses a second reload inside the cooldown, allows one after", () => {
    const s = memoryStorage("5000");
    expect(claimAutoReload(s, 5_000 + AUTO_RELOAD_COOLDOWN_MS - 1)).toBe(false);
    expect(claimAutoReload(s, 5_000 + AUTO_RELOAD_COOLDOWN_MS)).toBe(true);
  });

  it("ignores a corrupt stored value", () => {
    expect(claimAutoReload(memoryStorage("garbage"), 1_000)).toBe(true);
  });

  it("refuses without durable storage, so a reload can never loop", () => {
    expect(claimAutoReload(undefined, 1)).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    };
    expect(claimAutoReload(throwing, 1)).toBe(false);
    // Storage that silently drops writes can't hold the guard either.
    const dropping = { getItem: () => null, setItem: () => {} };
    expect(claimAutoReload(dropping, 1)).toBe(false);
    // Nor can storage that refuses writes (quota / private mode).
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(claimAutoReload(full, 1)).toBe(false);
  });
});

describe("autoReloadAllowed", () => {
  it("peeks without recording a claim", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
    expect(autoReloadAllowed(storage, 1_000)).toBe(true);
    expect(map.size).toBe(0);
    claimAutoReload(storage, 1_000);
    expect(
      autoReloadAllowed(storage, 1_000 + AUTO_RELOAD_COOLDOWN_MS - 1),
    ).toBe(false);
    expect(autoReloadAllowed(undefined, 1)).toBe(false);
  });
});

describe("sessionStorageOrUndefined", () => {
  it("returns the window's sessionStorage", () => {
    expect(sessionStorageOrUndefined()).toBe(window.sessionStorage);
  });

  it("returns undefined where reading it throws (sandboxed iframe)", () => {
    const spy = vi
      .spyOn(window, "sessionStorage", "get")
      .mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
    try {
      expect(sessionStorageOrUndefined()).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("followsRecentAutoReload", () => {
  const storageWith = (claimedAt: string | null) => {
    const map = new Map<string, string>();
    if (claimedAt !== null) map.set(AUTO_RELOAD_STORAGE_KEY, claimedAt);
    return {
      map,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
  };

  it("recognises the load right after our automatic reload", () => {
    expect(followsRecentAutoReload(storageWith("10000"), 10_000)).toBe(true);
    expect(
      followsRecentAutoReload(
        storageWith("10000"),
        10_000 + AUTO_RELOAD_RESULT_WINDOW_MS - 1,
      ),
    ).toBe(true);
  });

  // PR review: a later manual reload or navigation inside the window must
  // not be tagged as the automatic reload's result.
  it("tags only the first load after each automatic reload", () => {
    const s = storageWith("10000");
    expect(followsRecentAutoReload(s, 10_500)).toBe(true);
    expect(followsRecentAutoReload(s, 11_000)).toBe(false);
    // The loop-guard claim itself is left in place.
    expect(s.map.get(AUTO_RELOAD_STORAGE_KEY)).toBe("10000");
    // A newer automatic reload is recognised again.
    s.setItem(AUTO_RELOAD_STORAGE_KEY, "20000");
    expect(followsRecentAutoReload(s, 20_100)).toBe(true);
  });

  it("ignores an old reload, a clock that went backwards, or none at all", () => {
    expect(
      followsRecentAutoReload(
        storageWith("10000"),
        10_000 + AUTO_RELOAD_RESULT_WINDOW_MS,
      ),
    ).toBe(false);
    expect(followsRecentAutoReload(storageWith("10000"), 9_999)).toBe(false);
    expect(followsRecentAutoReload(storageWith(null), 10_000)).toBe(false);
  });

  it("is false without readable storage", () => {
    expect(followsRecentAutoReload(undefined, 1)).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    };
    expect(followsRecentAutoReload(throwing, 1)).toBe(false);
  });
});
