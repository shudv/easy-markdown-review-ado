import { describe, expect, it, vi } from "vitest";

import { orchestrateBoot, type BootDeps } from "../src/shell/boot";

/** Build deps that record call order into `calls`, with overridable steps. */
function makeDeps(calls: string[], overrides: Partial<BootDeps> = {}): BootDeps {
    return {
        init: vi.fn(async () => {
            calls.push("init");
        }),
        ready: vi.fn(async () => {
            calls.push("ready");
        }),
        run: vi.fn(async () => {
            calls.push("run");
        }),
        notifySucceeded: vi.fn(() => {
            calls.push("notifySucceeded");
        }),
        notifyFailed: vi.fn(() => {
            calls.push("notifyFailed");
        }),
        onError: vi.fn(() => {
            calls.push("onError");
        }),
        ...overrides,
    };
}

describe("orchestrateBoot", () => {
    it("initialises, waits for ready, runs the app, then reports success — the order the Azure DevOps SDK requires", async () => {
        // The host contract: rendering before `ready` or skipping
        // `notifyLoadSucceeded` causes timing-dependent startup failures.
        const calls: string[] = [];
        const deps = makeDeps(calls);

        await orchestrateBoot(deps);

        expect(calls).toEqual(["init", "ready", "run", "notifySucceeded"]);
    });

    it("does not start the app until a slow host handshake has completed", async () => {
        let finishHandshake!: () => void;

        const deps = makeDeps([], {
            ready: vi.fn(
                () =>
                    new Promise<void>((resolve) => {
                        finishHandshake = resolve;
                    }),
            ),
        });

        const booting = orchestrateBoot(deps);
        await Promise.resolve();
        await Promise.resolve();

        expect(deps.run).not.toHaveBeenCalled();

        finishHandshake();
        await booting;

        expect(deps.run).toHaveBeenCalled();
        expect(deps.notifySucceeded).toHaveBeenCalled();
    });

    it("reports the failure, and neither runs the app nor reports success, when the SDK fails to initialise", async () => {
        const calls: string[] = [];
        const boom = new Error("init failed");

        const deps = makeDeps(calls, {
            init: vi.fn(async () => {
                throw boom;
            }),
        });

        await orchestrateBoot(deps);

        expect(calls).toEqual(["onError", "notifyFailed"]);
        expect(deps.onError).toHaveBeenCalledWith(boom);
        expect(deps.notifyFailed).toHaveBeenCalledWith(boom);
    });

    it("reports a failure, not success, when the app fails to start after the handshake", async () => {
        const calls: string[] = [];
        const boom = new Error("render failed");

        const deps = makeDeps(calls, {
            run: vi.fn(async () => {
                throw boom;
            }),
        });

        await orchestrateBoot(deps);

        expect(calls).toEqual(["init", "ready", "onError", "notifyFailed"]);
        expect(deps.notifyFailed).toHaveBeenCalledWith(boom);
    });

    it("hands the host a real Error when the app fails with a thrown string", async () => {
        const deps = makeDeps([], {
            run: vi.fn(async () => {
                throw "string failure";
            }),
        });

        await orchestrateBoot(deps);

        expect(deps.notifyFailed).toHaveBeenCalledWith(new Error("string failure"));
    });

    it("completes quietly when the host cannot be told about the failure (SDK never initialised)", async () => {
        const deps = makeDeps([], {
            init: vi.fn(async () => {
                throw new Error("init failed");
            }),
            notifyFailed: vi.fn(() => {
                throw new Error("SDK not initialised");
            }),
        });

        await expect(orchestrateBoot(deps)).resolves.toBeUndefined();
    });

    it("still reports the failure to the host when error logging itself throws", async () => {
        const boom = new Error("run failed");

        const deps = makeDeps([], {
            run: vi.fn(async () => {
                throw boom;
            }),
            onError: vi.fn(() => {
                throw new Error("telemetry down");
            }),
        });

        await orchestrateBoot(deps);

        expect(deps.notifyFailed).toHaveBeenCalledWith(boom);
    });
});
