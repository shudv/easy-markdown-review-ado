import { beforeEach, describe, expect, it } from "vitest";

import {
  BOOT_ERROR_HEADING,
  bootErrorDetail,
  renderBootErrorInto,
} from "../src/shell/bootError";

describe("bootErrorDetail", () => {
  it("prefers an Error's stack, falls back to its message", () => {
    const withStack = new Error("boom");
    withStack.stack = "Error: boom\n  at x";
    expect(bootErrorDetail(withStack)).toBe("Error: boom\n  at x");

    const noStack = new Error("just a message");
    noStack.stack = undefined;
    expect(bootErrorDetail(noStack)).toBe("just a message");
  });

  it("stringifies non-Error values", () => {
    expect(bootErrorDetail("plain string")).toBe("plain string");
    expect(bootErrorDetail(42)).toBe("42");
    expect(bootErrorDetail(null)).toBe("null");
  });
});

describe("renderBootErrorInto", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
  });

  it("renders the heading and the detail text", () => {
    renderBootErrorInto(root, "something broke");
    expect(root.querySelector("h2")?.textContent).toBe(BOOT_ERROR_HEADING);
    expect(root.querySelector("pre")?.textContent).toBe("something broke");
  });

  it("does not interpret HTML in the detail (no injection)", () => {
    const hostile = '<img src=x onerror="alert(1)"><script>evil()</script>';
    renderBootErrorInto(root, hostile);

    // The hostile markup must appear as literal TEXT, not as parsed nodes.
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("pre")?.textContent).toBe(hostile);
    // innerHTML shows the text was entity-encoded by the DOM, never live.
    expect(root.innerHTML).not.toContain("<img");
    expect(root.innerHTML).not.toContain("<script>");
  });

  it("replaces any previously-rendered content", () => {
    root.innerHTML = "<span>stale spinner</span>";
    renderBootErrorInto(root, "fresh error");
    expect(root.textContent).not.toContain("stale spinner");
    expect(root.querySelector("pre")?.textContent).toBe("fresh error");
  });
});
