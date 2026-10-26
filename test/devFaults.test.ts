// Tests for the dev-only fault injector. It is the foundation of the e2e
// failure scenarios, so it must reproduce production conditions faithfully —
// in particular, its fake token must classify exactly like the real
// dead-window token.
//
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FAULTS_STORAGE_KEY,
  activeDeadToken,
  createFaultyFetch,
  deadWindowToken,
  faultsApi,
  installDevFaults,
  onBoot,
  readFaults,
  simulateHidden,
  writeFaults,
  type FaultConfig,
  type FaultDeps,
} from "../src/dev/faults";
import { classifyAdoGrant } from "../src/shell/adoAuthToken";
import {
  hostTokenOverride,
  setHostTokenOverride,
} from "../src/shell/hostToken";

const NOW = Date.UTC(2026, 9, 21, 9, 0, 0);
const ADO =
  "https://dev.azure.com/org/proj/_apis/git/repositories/r/pullRequests/1/threads";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

function deps(
  storage = memoryStorage(),
  now = NOW,
): FaultDeps & {
  storage: ReturnType<typeof memoryStorage>;
  sleep: ReturnType<typeof vi.fn>;
} {
  return { storage, now: () => now, sleep: vi.fn(async () => {}) };
}

function withConfig(cfg: FaultConfig) {
  const d = deps();
  writeFaults(d.storage, cfg);
  return d;
}

const okFetch = () =>
  vi.fn(
    async () => new Response("ok", { status: 200 }),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe("fault config storage", () => {
  it("round-trips, and clearing removes the key", () => {
    const s = memoryStorage();
    expect(readFaults(s)).toEqual({});
    writeFaults(s, { slowApiMs: 5 });
    expect(readFaults(s)).toEqual({ slowApiMs: 5 });
    writeFaults(s, {});
    expect(s.map.has(FAULTS_STORAGE_KEY)).toBe(false);
  });

  it("treats corrupt or non-object values as no faults", () => {
    const s = memoryStorage();
    s.setItem(FAULTS_STORAGE_KEY, "{not json");
    expect(readFaults(s)).toEqual({});
    s.setItem(FAULTS_STORAGE_KEY, "5");
    expect(readFaults(s)).toEqual({});
  });
});

describe("dead-window token", () => {
  // The whole point: the app must treat the fake exactly like production's.
  it("classifies as the dead window, recovering at the window's end", () => {
    const until = NOW + 5 * 60_000;
    const { state, recoverAtMs } = classifyAdoGrant(
      deadWindowToken(NOW, until),
      NOW,
    );
    expect(state).toBe("refreshing");
    expect(recoverAtMs).toBe(Math.floor(until / 1000) * 1000);
  });

  it("is only handed out while the window is open", () => {
    expect(activeDeadToken({}, NOW)).toBeNull();
    expect(activeDeadToken({ deadWindow: { untilMs: NOW } }, NOW)).toBeNull();
    expect(activeDeadToken({ deadWindow: { untilMs: NOW + 1 } }, NOW)).toMatch(
      /\.dev-fault$/,
    );
  });
});

describe("onBoot", () => {
  it("leaves configs without a dead window alone", () => {
    expect(onBoot({ slowApiMs: 1 }, NOW)).toEqual({ slowApiMs: 1 });
  });

  it("drops an expired window", () => {
    expect(onBoot({ deadWindow: { untilMs: NOW }, slowApiMs: 1 }, NOW)).toEqual(
      {
        slowApiMs: 1,
      },
    );
  });

  it("keeps a window that a reload does not heal", () => {
    const cfg = { deadWindow: { untilMs: NOW + 1 } };
    expect(onBoot(cfg, NOW)).toBe(cfg);
  });

  it("counts page loads down and lets the one after escape the window", () => {
    const first = onBoot(
      { deadWindow: { untilMs: NOW + 1, healAfterBoots: 1 } },
      NOW,
    );
    expect(first.deadWindow).toEqual({ untilMs: NOW + 1, healAfterBoots: 0 });
    expect(onBoot(first, NOW)).toEqual({});
  });
});

describe("createFaultyFetch", () => {
  it("never touches non-ADO requests", async () => {
    const original = okFetch();
    const d = withConfig({ deadWindow: { untilMs: NOW + 1 } });
    const res = await createFaultyFetch(
      original,
      d,
    )("https://cdn.example/x.js");
    expect(res.status).toBe(200);
    expect(original).toHaveBeenCalledOnce();
  });

  it("passes ADO requests through when no fault is active", async () => {
    const original = okFetch();
    const d = withConfig({
      deadWindow: { untilMs: NOW },
      plain401: { untilMs: NOW - 1 },
    });
    const res = await createFaultyFetch(original, d)(new URL(ADO));
    expect(res.status).toBe(200);
  });

  it("answers ADO requests in a dead window with ADO's real 401 TF400813", async () => {
    const original = okFetch();
    const d = withConfig({ deadWindow: { untilMs: NOW + 1 } });
    const res = await createFaultyFetch(original, d)(ADO);
    expect(original).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
    expect(res.url).toBe(ADO);
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(((await res.json()) as { message: string }).message).toContain(
      "TF400813",
    );
  });

  it("answers plain 401s the same way (only the token differs)", async () => {
    const d = withConfig({ plain401: { untilMs: NOW + 1 } });
    const res = await createFaultyFetch(okFetch(), d)(ADO);
    expect(res.status).toBe(401);
  });

  it("delays ADO requests when the host is slow", async () => {
    const d = withConfig({ slowApiMs: 20_000 });
    await createFaultyFetch(okFetch(), d)(ADO);
    await createFaultyFetch(okFetch(), d)(ADO);
    expect(d.sleep).toHaveBeenCalledTimes(2);
    expect(d.sleep).toHaveBeenCalledWith(20_000);
  });

  it("can delay just the next few ADO requests", async () => {
    const d = withConfig({ slowApiMs: 16_000, slowApiRemaining: 2 });
    const faulty = createFaultyFetch(okFetch(), d);
    await faulty(ADO);
    expect(readFaults(d.storage).slowApiRemaining).toBe(1);
    await faulty(ADO);
    expect(readFaults(d.storage)).toEqual({});
    await faulty(ADO);
    expect(d.sleep).toHaveBeenCalledTimes(2);
  });

  it("drops exactly the next write with a network error", async () => {
    const original = okFetch();
    const d = withConfig({ failNextWrite: true });
    const faulty = createFaultyFetch(original, d);

    await faulty(ADO); // a read is not a write
    expect(readFaults(d.storage).failNextWrite).toBe(true);

    await expect(faulty(ADO, { method: "post" })).rejects.toThrow(
      "Failed to fetch",
    );
    expect(readFaults(d.storage).failNextWrite).toBeUndefined();
    await faulty(new Request(ADO, { method: "PATCH" }));
    expect(original).toHaveBeenCalledTimes(2);
  });

  it("reads a Request's method when no init is given", async () => {
    const d = withConfig({ failNextWrite: true });
    await expect(
      createFaultyFetch(okFetch(), d)(new Request(ADO, { method: "POST" })),
    ).rejects.toThrow("Failed to fetch");
  });
});

describe("faultsApi", () => {
  it("drives every fault through sessionStorage", () => {
    const d = deps();
    const api = faultsApi(d);
    expect(api.deadWindow()).toEqual({
      deadWindow: { untilMs: NOW + 120_000 },
    });
    api.deadWindow({ seconds: 30, healAfterBoots: 0 });
    expect(api.status().deadWindow).toEqual({
      untilMs: NOW + 30_000,
      healAfterBoots: 0,
    });
    api.plain401();
    expect(api.status().plain401).toEqual({ untilMs: NOW + 60_000 });
    api.plain401(5);
    expect(api.status().plain401).toEqual({ untilMs: NOW + 5_000 });
    api.slowApi(250);
    expect(api.status().slowApiMs).toBe(250);
    api.slowApi(16_000, 1);
    expect(api.status()).toMatchObject({
      slowApiMs: 16_000,
      slowApiRemaining: 1,
    });
    api.slowApi(0);
    expect(api.status().slowApiMs).toBeUndefined();
    expect(api.status().slowApiRemaining).toBeUndefined();
    api.hidden(20);
    expect(api.status().hiddenUntilMs).toBe(NOW + 20_000);
    api.failNextWrite();
    expect(api.status().failNextWrite).toBe(true);
    api.clear();
    expect(api.status()).toEqual({});
    expect(d.storage.map.size).toBe(0);
  });
});

describe("simulateHidden", () => {
  afterEach(() => {
    delete (document as { visibilityState?: unknown }).visibilityState;
  });

  it("reports hidden until the deadline, then visible, with events", () => {
    let fire!: () => void;
    const schedule = vi.fn((fn: () => void) => (fire = fn));
    const events: string[] = [];
    const listener = () => events.push(document.visibilityState);
    document.addEventListener("visibilitychange", listener);
    try {
      simulateHidden(document, NOW + 5_000, () => NOW, schedule);
      expect(document.visibilityState).toBe("hidden");
      expect(schedule).toHaveBeenCalledWith(expect.any(Function), 5_000);
      fire();
      expect(document.visibilityState).toBe("visible");
      expect(events).toEqual(["hidden", "visible"]);
    } finally {
      document.removeEventListener("visibilitychange", listener);
    }
  });

  it("does nothing once the deadline has passed", () => {
    const schedule = vi.fn();
    simulateHidden(document, NOW, () => NOW, schedule);
    expect(schedule).not.toHaveBeenCalled();
    expect(document.visibilityState).toBe("visible");
  });
});

describe("installDevFaults", () => {
  const originalFetch = window.fetch.bind(window);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    window.fetch = originalFetch;
    setHostTokenOverride(null);
    delete (window as { __emrFaults?: unknown }).__emrFaults;
    delete (document as { visibilityState?: unknown }).visibilityState;
    window.sessionStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("wires the fetch faults, token override, hidden page and console API", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    window.fetch = vi.fn(
      async () => new Response("ok"),
    ) as unknown as typeof fetch;
    const d = deps(memoryStorage(), NOW);
    d.now = () => Date.now();
    writeFaults(d.storage, {
      deadWindow: { untilMs: NOW + 60_000 },
      hiddenUntilMs: NOW + 1_000,
    });

    installDevFaults(d);

    expect(warn).toHaveBeenCalledWith(
      "[dev faults] active:",
      expect.anything(),
    );
    expect((await window.fetch(ADO)).status).toBe(401);
    expect(classifyAdoGrant(hostTokenOverride()!, Date.now()).state).toBe(
      "refreshing",
    );
    expect(document.visibilityState).toBe("hidden");
    vi.advanceTimersByTime(1_000);
    expect(document.visibilityState).toBe("visible");

    // The window ends: real token, real responses.
    vi.advanceTimersByTime(60_000);
    expect(hostTokenOverride()).toBeNull();
    expect((await window.fetch(ADO)).status).toBe(200);

    const api = (
      window as unknown as { __emrFaults: ReturnType<typeof faultsApi> }
    ).__emrFaults;
    api.clear();
    expect(d.storage.map.size).toBe(0);
  });

  it("is quiet with no faults, using the window's sessionStorage by default", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const real = vi.fn(async () => new Response("ok"));
    window.fetch = real as unknown as typeof fetch;
    installDevFaults();
    expect(warn).not.toHaveBeenCalled();
    expect(hostTokenOverride()).toBeNull();
    const api = (
      window as unknown as { __emrFaults: ReturnType<typeof faultsApi> }
    ).__emrFaults;
    api.slowApi(10);
    expect(window.sessionStorage.getItem(FAULTS_STORAGE_KEY)).toContain("10");

    // The default sleep really waits before letting the request through.
    const pending = window.fetch(ADO);
    await vi.advanceTimersByTimeAsync(9);
    expect(real).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe(200);
  });
});

describe("hostToken seam", () => {
  it("defers to the real token until an override is registered", () => {
    setHostTokenOverride(null);
    expect(hostTokenOverride()).toBeNull();
    setHostTokenOverride(() => "fake");
    expect(hostTokenOverride()).toBe("fake");
    setHostTokenOverride(null);
    expect(hostTokenOverride()).toBeNull();
  });
});
