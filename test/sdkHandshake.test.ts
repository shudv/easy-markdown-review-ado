// Tests for the SDK host-handshake retry: the SDK leaves a refused handshake
// as an unhandled rejection and never settles `init()`, so boot must own it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HANDSHAKE_RETRY_DELAYS_MS,
  HostHandshakeError,
  initWithHandshakeRetry,
  isHostHandshakeRejection,
} from "../src/shell/sdkHandshake";

// The reason the host sends back, as seen in production (`object:Object`).
const REFUSAL = {
  message: "The registered object DevOps.HostControl could not be found.",
};

/** A controllable stand-in for `window`'s unhandled-rejection stream. */
function rejectionStream() {
  const listeners = new Set<(reason: unknown) => void>();

  return {
    listeners,
    subscribe: (listener: (reason: unknown) => void) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    emit: (reason: unknown) => {
      for (const listener of [...listeners]) listener(reason);
    },
  };
}

/** An `SDK.init` fake: refused attempts never settle, like the real SDK. */
function sdkInit(stream: ReturnType<typeof rejectionStream>) {
  let refuseNext = 0;
  const pending: Array<() => void> = [];

  const init = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        if (refuseNext > 0) {
          refuseNext -= 1;
          queueMicrotask(() => stream.emit(REFUSAL));

          return;
        }

        pending.push(resolve);
      }),
  );

  return {
    init,
    refuse(times: number) {
      refuseNext = times;
    },
    accept() {
      pending.shift()!();
    },
  };
}

describe("isHostHandshakeRejection", () => {
  it.each<[string, unknown, boolean]>([
    ["the host's plain-object reason", REFUSAL, true],
    ["an Error carrying it", new Error(REFUSAL.message), true],
    ["the bare message", REFUSAL.message, true],
    ["another registered object", { message: "registered object X" }, false],
    ["a non-string message", { message: 42 }, false],
    ["null", null, false],
    ["undefined", undefined, false],
  ])("recognises %s → %s", (_label, reason, expected) => {
    expect(isHostHandshakeRejection(reason)).toBe(expected);
  });
});

describe("initWithHandshakeRetry", () => {
  let stream: ReturnType<typeof rejectionStream>;
  let claim: ReturnType<typeof vi.fn>;
  let release: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    stream = rejectionStream();
    release = vi.fn();
    claim = vi.fn(() => release);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves on a first successful handshake and cleans up", async () => {
    const sdk = sdkInit(stream);

    const done = initWithHandshakeRetry({
      init: sdk.init,
      subscribeRejections: stream.subscribe,
      claim,
    });

    sdk.accept();
    await expect(done).resolves.toBeUndefined();
    expect(sdk.init).toHaveBeenCalledOnce();
    expect(claim).toHaveBeenCalledWith(isHostHandshakeRejection);
    expect(release).toHaveBeenCalledOnce();
    expect(stream.listeners.size).toBe(0);
  });

  // Production: 13 sessions a week hit the refusal 10–550 ms into boot and
  // hung behind the host spinner with an unhandled rejection.
  it("re-sends a refused handshake after each delay until the host accepts", async () => {
    const sdk = sdkInit(stream);
    sdk.refuse(2);

    const done = initWithHandshakeRetry({
      init: sdk.init,
      subscribeRejections: stream.subscribe,
      claim,
      delaysMs: [100, 500],
    });

    await vi.advanceTimersByTimeAsync(99);
    expect(sdk.init).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(sdk.init).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(sdk.init).toHaveBeenCalledTimes(3);

    sdk.accept();
    await expect(done).resolves.toBeUndefined();
  });

  it("gives up with a HostHandshakeError once every attempt is refused", async () => {
    const sdk = sdkInit(stream);
    sdk.refuse(3);

    const done = initWithHandshakeRetry({
      init: sdk.init,
      subscribeRejections: stream.subscribe,
      claim,
      delaysMs: [10, 10],
    });

    await Promise.all([
      expect(done).rejects.toEqual(
        expect.objectContaining({ name: "HostHandshakeError", attempts: 3 }),
      ),
      vi.advanceTimersByTimeAsync(20),
    ]);
    await expect(done).rejects.toBeInstanceOf(HostHandshakeError);
    expect(sdk.init).toHaveBeenCalledTimes(3);
    expect(release).toHaveBeenCalledOnce();
    expect(stream.listeners.size).toBe(0);
  });

  it("ignores unrelated rejections", async () => {
    const sdk = sdkInit(stream);

    const done = initWithHandshakeRetry({
      init: sdk.init,
      subscribeRejections: stream.subscribe,
      claim,
    });

    stream.emit(new Error("something else"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sdk.init).toHaveBeenCalledOnce();
    sdk.accept();
    await expect(done).resolves.toBeUndefined();
  });

  it("passes an init rejection through", async () => {
    const boom = new Error("boom");

    await expect(
      initWithHandshakeRetry({
        init: () => Promise.reject(boom),
        subscribeRejections: stream.subscribe,
        claim,
      }),
    ).rejects.toBe(boom);
    expect(release).toHaveBeenCalledOnce();
  });

  it("settles once, ignoring a straggling attempt or refusal afterwards", async () => {
    let resolveFirst!: () => void;

    const init = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (resolveFirst = resolve)),
      )
      .mockResolvedValueOnce(undefined);

    const done = initWithHandshakeRetry({
      init,
      subscribeRejections: stream.subscribe,
      claim,
      delaysMs: [10],
    });

    stream.emit(REFUSAL);
    await vi.advanceTimersByTimeAsync(10);
    await expect(done).resolves.toBeUndefined();

    resolveFirst();
    await vi.advanceTimersByTimeAsync(0);
    expect(release).toHaveBeenCalledOnce();
  });

  it("listens to window rejections and claims through telemetry by default", async () => {
    vi.useRealTimers();
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    let accept!: () => void;

    const done = initWithHandshakeRetry({
      init: () => new Promise<void>((resolve) => (accept = resolve)),
      delaysMs: [],
    });

    const [, onRejection] = added.mock.calls.find(
      ([type]) => type === "unhandledrejection",
    )!;

    const event = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(event, "reason", { value: new Error("unrelated") });
    window.dispatchEvent(event);
    accept();
    await expect(done).resolves.toBeUndefined();
    expect(removed).toHaveBeenCalledWith("unhandledrejection", onRejection);

    added.mockRestore();
    removed.mockRestore();
  });

  it("follows the production retry schedule by default", async () => {
    const sdk = sdkInit(stream);
    sdk.refuse(HANDSHAKE_RETRY_DELAYS_MS.length + 1);

    const done = initWithHandshakeRetry({
      init: sdk.init,
      subscribeRejections: stream.subscribe,
      claim,
    });

    const total = HANDSHAKE_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    let rejected = false;
    done.catch(() => (rejected = true));
    await vi.advanceTimersByTimeAsync(total - 1);
    expect(sdk.init).toHaveBeenCalledTimes(HANDSHAKE_RETRY_DELAYS_MS.length);
    expect(rejected).toBe(false);
    await Promise.all([
      expect(done).rejects.toBeInstanceOf(HostHandshakeError),
      vi.advanceTimersByTimeAsync(1),
    ]);
    expect(sdk.init).toHaveBeenCalledTimes(
      HANDSHAKE_RETRY_DELAYS_MS.length + 1,
    );
  });
});
