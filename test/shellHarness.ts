// Shared jsdom harness for the Shell hook tests: mounts a hook in a real
// React root so its effects, state and callbacks run as they do in the shell.

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";

import type { CommentApi } from "../src/comments/api";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

export interface MountedHook<P, R> {
  /** The hook's latest return value. */
  readonly current: R;
  rerender: (props: P) => Promise<void>;
  unmount: () => void;
}

/** Mounts `useHook(props)` and returns its latest result plus controls. */
export async function mountHook<P, R>(
  useHook: (props: P) => R,
  props: P,
): Promise<MountedHook<P, R>> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const latest: { value?: R } = {};
  function Harness(harnessProps: { hookProps: P }): null {
    latest.value = useHook(harnessProps.hookProps);
    return null;
  }
  const rerender = async (next: P): Promise<void> => {
    await act(async () => {
      root.render(React.createElement(Harness, { hookProps: next }));
    });
  };
  await rerender(props);
  return {
    get current() {
      return latest.value as R;
    },
    rerender,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const pendingUnmounts: Array<() => void> = [];

/** Registers a teardown for the next {@link unmountAll} (call in afterEach). */
export function onUnmountAll(teardown: () => void): void {
  pendingUnmounts.push(teardown);
}

/** {@link mountHook}, torn down by the next {@link unmountAll}. */
export async function mountTracked<P, R>(
  useHook: (props: P) => R,
  props: P,
): Promise<MountedHook<P, R>> {
  const hook = await mountHook(useHook, props);
  onUnmountAll(hook.unmount);
  return hook;
}

/** Unmounts everything mounted via {@link mountTracked} / {@link onUnmountAll}. */
export function unmountAll(): void {
  while (pendingUnmounts.length > 0) pendingUnmounts.pop()!();
}

/** Lets pending promise callbacks and state updates settle inside `act`. */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

/** A promise settled from the outside, to hold a load mid-flight. */
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Replaces `requestAnimationFrame` with a manual queue so a test decides when
 * frames run. Returns `flush` (runs the frames queued so far) and `restore`.
 */
export function manualFrames(): { flush: () => void; restore: () => void } {
  let queue = new Map<number, FrameRequestCallback>();
  let next = 1;
  const request = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((cb: FrameRequestCallback): number => {
      const handle = next++;
      queue.set(handle, cb);
      return handle;
    });
  const cancel = vi
    .spyOn(window, "cancelAnimationFrame")
    .mockImplementation((handle: number): void => {
      queue.delete(handle);
    });
  return {
    flush: () => {
      const due = queue;
      queue = new Map();
      act(() => {
        for (const cb of due.values()) cb(0);
      });
    },
    restore: () => {
      request.mockRestore();
      cancel.mockRestore();
    },
  };
}

/** jsdom has no `CSS.escape`; install a pass-through when it's missing. */
export function ensureCssEscape(): void {
  const g = globalThis as unknown as {
    CSS?: { escape?: (s: string) => string };
  };
  if (g.CSS?.escape) return;
  g.CSS = { ...g.CSS, escape: (s: string) => s };
}

/** Markdown source whose render waits on `heldRender.gate` (when set). */
export const HELD_SOURCE = "# Held";
export const heldRender: { gate: Deferred<void> | null } = { gate: null };

/**
 * Wraps the real render module so rendering {@link HELD_SOURCE} pauses until
 * `heldRender.gate` resolves — holding a load between its fetch and render.
 * Use from a `vi.mock("../src/markdown/render", ...)` factory.
 */
export function withHeldRender<
  M extends { renderMarkdown: (md: string) => Promise<string> },
>(actual: M): M {
  return {
    ...actual,
    renderMarkdown: async (md: string) => {
      if (md === HELD_SOURCE && heldRender.gate) await heldRender.gate.promise;
      return actual.renderMarkdown(md);
    },
  };
}

/**
 * A CommentApi whose writes succeed; it has no `resolveIdentities`. Its
 * members are plain `vi.fn` properties, so tests can assert on them directly.
 */
export function stubCommentApi() {
  const api = {
    createThread: vi.fn(async () => ({
      threadId: "t-new",
      firstCommentId: "c-server",
      createdAt: "2024-01-01T00:00:00Z",
    })),
    addReply: vi.fn(),
    editComment: vi.fn(),
    deleteComment: vi.fn(async () => {}),
    setStatus: vi.fn(async () => {}),
    toggleReaction: vi.fn(async () => {}),
    searchUsers: vi.fn(),
    searchWorkItems: vi.fn(),
    searchPullRequests: vi.fn(),
  };
  return api satisfies CommentApi;
}
