import { describe, expect, it } from "vitest";

import {
  resolveInitialDocPath,
  shouldPublishDefaultPath,
} from "../src/hub/documentsAppRouting";

describe("resolveInitialDocPath", () => {
  it("prefers the deep-link / cache path when present", () => {
    expect(resolveInitialDocPath("/docs/deep.md", "/docs/first.md")).toBe(
      "/docs/deep.md",
    );
  });

  it("falls back to the first file when there is no deep link", () => {
    expect(resolveInitialDocPath(undefined, "/docs/first.md")).toBe(
      "/docs/first.md",
    );
  });

  it("returns '' when neither is resolved (skeleton not yet filled)", () => {
    expect(resolveInitialDocPath(undefined, undefined)).toBe("");
  });
});

describe("shouldPublishDefaultPath", () => {
  it("does not publish an empty path (skeleton with no files yet)", () => {
    // The whole point of the latch: an empty skeleton must NOT consume the
    // one-shot publish, so it retries once files land.
    expect(shouldPublishDefaultPath(null, "repoA", "")).toBe(false);
  });

  it("publishes once a real path resolves for an unpublished repo", () => {
    expect(shouldPublishDefaultPath(null, "repoA", "/docs/a.md")).toBe(true);
  });

  it("does not re-publish a repo already published", () => {
    expect(shouldPublishDefaultPath("repoA", "repoA", "/docs/a.md")).toBe(
      false,
    );
  });

  it("publishes again after switching to a different repo", () => {
    // repoA was published; selecting repoB (files resolved) should publish it.
    expect(shouldPublishDefaultPath("repoA", "repoB", "/docs/b.md")).toBe(true);
  });

  it("models the skeleton→files-land sequence for a fresh repo", () => {
    // Render 1: repoB just selected, files empty (skeleton) → no publish.
    expect(shouldPublishDefaultPath("repoA", "repoB", "")).toBe(false);
    // Render 2: repoB files streamed in → publish exactly once.
    expect(shouldPublishDefaultPath("repoA", "repoB", "/docs/b.md")).toBe(true);
    // Render 3: repoB now latched as published → no duplicate publish.
    expect(shouldPublishDefaultPath("repoB", "repoB", "/docs/b.md")).toBe(
      false,
    );
  });
});
