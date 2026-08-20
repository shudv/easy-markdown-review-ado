// Unit tests for the clipboard write helper. jsdom does not implement the real
// Clipboard API or `execCommand`, so we stub both to drive each strategy.
//
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { copyText } from "../src/comments/clipboard";

const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);

function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, "clipboard", {
    value,
    configurable: true,
  });
}

// jsdom ships without `document.execCommand`, so assigning a stub adds it; we
// remove it again afterwards.
function setExecCommand(impl: (command: string) => boolean): void {
  (document as { execCommand?: unknown }).execCommand = impl;
}

afterEach(() => {
  if (originalClipboard) {
    Object.defineProperty(navigator, "clipboard", originalClipboard);
  } else {
    // jsdom ships without `navigator.clipboard`; remove our stub.
    delete (navigator as { clipboard?: unknown }).clipboard;
  }
  delete (document as { execCommand?: unknown }).execCommand;
  vi.restoreAllMocks();
});

describe("copyText", () => {
  it("uses the async Clipboard API when available", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard({ writeText });

    await expect(copyText("https://example.test/#c1")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://example.test/#c1");
  });

  it("falls back to execCommand when the async API rejects (blocked)", async () => {
    const writeText = vi.fn(() => Promise.reject(new Error("NotAllowedError")));
    setClipboard({ writeText });
    const exec = vi.fn(() => true);
    setExecCommand(exec);

    await expect(copyText("link")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalled();
    expect(exec).toHaveBeenCalledWith("copy");
    // The transient textarea is cleaned up.
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("falls straight to execCommand when the async API is absent", async () => {
    setClipboard(undefined);
    const exec = vi.fn(() => true);
    setExecCommand(exec);

    await expect(copyText("link")).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("returns false when execCommand reports no copy", async () => {
    setClipboard(undefined);
    setExecCommand(() => false);

    await expect(copyText("link")).resolves.toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("returns false (and never throws) when execCommand throws", async () => {
    setClipboard(undefined);
    setExecCommand(() => {
      throw new Error("execCommand unavailable");
    });

    await expect(copyText("link")).resolves.toBe(false);
  });
});
