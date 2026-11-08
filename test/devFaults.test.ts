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
import { hostTokenOverride, setHostTokenOverride } from "../src/shell/hostToken";

const NOW = Date.UTC(2026, 9, 21, 9, 0, 0);

const ADO = "https://dev.azure.com/org/proj/_apis/git/repositories/r/pullRequests/1/threads";

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
    vi.fn(async () => new Response("ok", { status: 200 })) as unknown as typeof fetch &
        ReturnType<typeof vi.fn>;

describe("fault config storage", () => {
    it("has no faults until some are written, then reads them back", () => {
        const s = memoryStorage();

        expect(readFaults(s)).toEqual({});

        writeFaults(s, { slowApiMs: 5 });

        expect(readFaults(s)).toEqual({ slowApiMs: 5 });
    });

    it("removes the stored key when every fault is cleared", () => {
        const s = memoryStorage();
        writeFaults(s, { slowApiMs: 5 });

        writeFaults(s, {});

        expect(s.map.has(FAULTS_STORAGE_KEY)).toBe(false);
    });

    it.each([
        { name: "corrupt JSON", stored: "{not json" },
        { name: "a non-object value", stored: "5" },
    ])("treats $name as no faults", ({ stored }) => {
        const s = memoryStorage();
        s.setItem(FAULTS_STORAGE_KEY, stored);

        expect(readFaults(s)).toEqual({});
    });
});

describe("dead-window token", () => {
    // The whole point: the app must treat the fake exactly like production's.
    it("classifies as the dead window, recovering at the window's end", () => {
        const until = NOW + 5 * 60_000;

        const { state, recoverAtMs } = classifyAdoGrant(deadWindowToken(NOW, until), NOW);

        expect(state).toBe("refreshing");
        expect(recoverAtMs).toBe(Math.floor(until / 1000) * 1000);
    });

    it.each([
        { name: "there is no dead window", config: {} },
        { name: "the window has just ended", config: { deadWindow: { untilMs: NOW } } },
    ])("is not handed out when $name", ({ config }) => {
        expect(activeDeadToken(config, NOW)).toBeNull();
    });

    it("is handed out while the window is open", () => {
        expect(activeDeadToken({ deadWindow: { untilMs: NOW + 1 } }, NOW)).toMatch(/\.dev-fault$/);
    });
});

describe("onBoot", () => {
    it("leaves configs without a dead window alone", () => {
        expect(onBoot({ slowApiMs: 1 }, NOW)).toEqual({ slowApiMs: 1 });
    });

    it("drops an expired window", () => {
        expect(onBoot({ deadWindow: { untilMs: NOW }, slowApiMs: 1 }, NOW)).toEqual({
            slowApiMs: 1,
        });
    });

    it("keeps a window that a reload does not heal", () => {
        const cfg = { deadWindow: { untilMs: NOW + 1 } };
        expect(onBoot(cfg, NOW)).toBe(cfg);
    });

    it("counts page loads down and lets the one after escape the window", () => {
        const first = onBoot({ deadWindow: { untilMs: NOW + 1, healAfterBoots: 1 } }, NOW);

        expect(first.deadWindow).toEqual({
            untilMs: NOW + 1,
            healAfterBoots: 0,
        });
        expect(onBoot(first, NOW)).toEqual({});
    });
});

describe("createFaultyFetch", () => {
    it("never touches non-ADO requests", async () => {
        const original = okFetch();
        const d = withConfig({ deadWindow: { untilMs: NOW + 1 } });

        const res = await createFaultyFetch(original, d)("https://cdn.example/x.js");

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
        expect(res.statusText).toBe("Unauthorized");
        expect(res.url).toBe(ADO);
        expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
        expect(res.headers.get("Content-Type")).toContain("application/json");
        expect(await res.json()).toMatchObject({
            message: expect.stringContaining("TF400813"),
            typeKey: "UnauthorizedRequestException",
            typeName: expect.stringContaining("UnauthorizedRequestException"),
        });
    });

    it.each([
        { form: "URL string", request: () => ADO },
        { form: "URL object", request: () => new URL(ADO) },
        { form: "Request", request: () => new Request(ADO) },
    ])("answers a dead-window ADO request made with a $form", async ({ request }) => {
        const d = withConfig({ deadWindow: { untilMs: NOW + 1 } });

        const res = await createFaultyFetch(okFetch(), d)(request());

        expect(res.status).toBe(401);
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

        await expect(faulty(ADO, { method: "post" })).rejects.toThrow("Failed to fetch");
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
    type Api = ReturnType<typeof faultsApi>;

    it.each([
        {
            name: "opens a two-minute dead window by default",
            act: (api: Api) => api.deadWindow(),
            expected: { deadWindow: { untilMs: NOW + 120_000 } },
        },
        {
            name: "opens a dead window of a chosen length and reload budget",
            act: (api: Api) => api.deadWindow({ seconds: 30, healAfterBoots: 0 }),
            expected: { deadWindow: { untilMs: NOW + 30_000, healAfterBoots: 0 } },
        },
        {
            name: "answers plain 401s for a minute by default",
            act: (api: Api) => api.plain401(),
            expected: { plain401: { untilMs: NOW + 60_000 } },
        },
        {
            name: "answers plain 401s for a chosen number of seconds",
            act: (api: Api) => api.plain401(5),
            expected: { plain401: { untilMs: NOW + 5_000 } },
        },
        {
            name: "slows every ADO request",
            act: (api: Api) => api.slowApi(250),
            expected: { slowApiMs: 250 },
        },
        {
            name: "slows only the next few ADO requests",
            act: (api: Api) => api.slowApi(16_000, 1),
            expected: { slowApiMs: 16_000, slowApiRemaining: 1 },
        },
        {
            name: "hides the page for a chosen number of seconds",
            act: (api: Api) => api.hidden(20),
            expected: { hiddenUntilMs: NOW + 20_000 },
        },
        {
            name: "fails the next write",
            act: (api: Api) => api.failNextWrite(),
            expected: { failNextWrite: true },
        },
    ])("$name", ({ act, expected }) => {
        const api = faultsApi(deps());

        act(api);

        expect(api.status()).toEqual(expected);
    });

    it("turning the slowdown off also forgets its request limit", () => {
        const api = faultsApi(deps());
        api.slowApi(16_000, 1);

        api.slowApi(0);

        expect(api.status()).toEqual({});
    });

    it("clears every fault from sessionStorage", () => {
        const d = deps();
        const api = faultsApi(d);
        api.deadWindow();
        api.slowApi(250);
        api.failNextWrite();

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
        window.fetch = vi.fn(async () => new Response("ok")) as unknown as typeof fetch;
        const d = deps(memoryStorage(), NOW);
        d.now = () => Date.now();
        writeFaults(d.storage, {
            deadWindow: { untilMs: NOW + 60_000 },
            hiddenUntilMs: NOW + 1_000,
        });

        installDevFaults(d);

        expect(warn).toHaveBeenCalledWith("[dev faults] active:", expect.anything());
        expect((await window.fetch(ADO)).status).toBe(401);
        expect(classifyAdoGrant(hostTokenOverride()!, Date.now()).state).toBe("refreshing");
        expect(document.visibilityState).toBe("hidden");
        vi.advanceTimersByTime(1_000);
        expect(document.visibilityState).toBe("visible");

        // The window ends: real token, real responses.
        vi.advanceTimersByTime(60_000);
        expect(hostTokenOverride()).toBeNull();
        expect((await window.fetch(ADO)).status).toBe(200);

        const api = (window as unknown as { __emrFaults: ReturnType<typeof faultsApi> })
            .__emrFaults;

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

        const api = (window as unknown as { __emrFaults: ReturnType<typeof faultsApi> })
            .__emrFaults;

        api.slowApi(10);
        // The literal key: it survives a host reload, and the production-build
        // check (scripts/check-no-dev-faults.mjs) scans for it.
        expect(window.sessionStorage.getItem("emr.devFaults")).toContain("10");

        // The default sleep really waits before letting the request through.
        const pending = window.fetch(ADO);
        await vi.advanceTimersByTimeAsync(9);
        expect(real).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect((await pending).status).toBe(200);
    });

    it("leaves the page visible when no hidden fault is set", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        window.fetch = vi.fn(async () => new Response("ok")) as unknown as typeof fetch;
        const d = deps(memoryStorage(), NOW);
        writeFaults(d.storage, { slowApiMs: 5 });

        installDevFaults(d);

        expect(document.visibilityState).toBe("visible");
    });

    it("opens a dead window from the console that the page's ADO requests then hit", async () => {
        window.fetch = vi.fn(async () => new Response("ok")) as unknown as typeof fetch;
        installDevFaults();

        const api = (window as unknown as { __emrFaults: ReturnType<typeof faultsApi> })
            .__emrFaults;

        api.deadWindow({ seconds: 30 });

        expect((await window.fetch(ADO)).status).toBe(401);
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
