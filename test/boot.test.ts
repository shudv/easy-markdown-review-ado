import { describe, expect, it, vi } from "vitest";

import { orchestrateBoot, type BootDeps } from "../src/shell/boot";

/** Build deps that record call order into `calls`, with overridable steps. */
function makeDeps(
  calls: string[],
  overrides: Partial<BootDeps> = {},
): BootDeps {
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
  it("runs the happy path in strict order", async () => {
    const calls: string[] = [];
    const deps = makeDeps(calls);
    await orchestrateBoot(deps);
    expect(calls).toEqual(["init", "ready", "run", "notifySucceeded"]);
    expect(deps.notifyFailed).not.toHaveBeenCalled();
    expect(deps.onError).not.toHaveBeenCalled();
  });

  it("does not render (run) or notify success before ready resolves", async () => {
    const calls: string[] = [];
    let readyResolved = false;
    const deps = makeDeps(calls, {
      ready: vi.fn(async () => {
        // A microtask hop; run must not have executed yet.
        await Promise.resolve();
        readyResolved = true;
        calls.push("ready");
      }),
      run: vi.fn(async () => {
        expect(readyResolved).toBe(true);
        calls.push("run");
      }),
    });
    await orchestrateBoot(deps);
    expect(calls).toEqual(["init", "ready", "run", "notifySucceeded"]);
  });

  it("skips ready/run/success and notifies failure when init rejects", async () => {
    const calls: string[] = [];
    const boom = new Error("init failed");
    const deps = makeDeps(calls, {
      init: vi.fn(async () => {
        throw boom;
      }),
    });
    await orchestrateBoot(deps);
    expect(calls).toEqual(["onError", "notifyFailed"]);
    expect(deps.ready).not.toHaveBeenCalled();
    expect(deps.run).not.toHaveBeenCalled();
    expect(deps.notifySucceeded).not.toHaveBeenCalled();
    expect(deps.onError).toHaveBeenCalledWith(boom);
    expect(deps.notifyFailed).toHaveBeenCalledWith(boom);
  });

  it("notifies failure (not success) when run rejects after ready", async () => {
    const calls: string[] = [];
    const boom = new Error("render failed");
    const deps = makeDeps(calls, {
      run: vi.fn(async () => {
        throw boom;
      }),
    });
    await orchestrateBoot(deps);
    expect(calls).toEqual(["init", "ready", "onError", "notifyFailed"]);
    expect(deps.notifySucceeded).not.toHaveBeenCalled();
    expect(deps.notifyFailed).toHaveBeenCalledWith(boom);
  });

  it("wraps a non-Error rejection into an Error for notifyFailed", async () => {
    const calls: string[] = [];
    const deps = makeDeps(calls, {
      run: vi.fn(async () => {
        throw "string failure";
      }),
    });
    await orchestrateBoot(deps);
    const arg = (deps.notifyFailed as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(arg).toBeInstanceOf(Error);
    expect((arg as Error).message).toBe("string failure");
  });

  it("swallows a throw from notifyFailed (host API unavailable)", async () => {
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

  it("still notifies failure when the error sink itself throws", async () => {
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
