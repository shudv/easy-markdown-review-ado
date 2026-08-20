// Tests for the theme module's pure helpers AND DOM side-effects.
//
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ALL_THEMES,
  applyTheme,
  isEmrTheme,
  parseLuminance,
  refreshHostTheme,
  resolveHostTheme,
  syncHostTheme,
} from "../src/theme/theme";

describe("isEmrTheme", () => {
  it("accepts each declared theme", () => {
    for (const t of ALL_THEMES) {
      expect(isEmrTheme(t.id)).toBe(true);
    }
  });

  it("rejects unknown strings and non-strings", () => {
    expect(isEmrTheme("solarized")).toBe(false);
    expect(isEmrTheme("")).toBe(false);
    expect(isEmrTheme(null)).toBe(false);
    expect(isEmrTheme(undefined)).toBe(false);
    expect(isEmrTheme(42)).toBe(false);
  });
});

describe("parseLuminance", () => {
  it("returns null on empty / whitespace input", () => {
    expect(parseLuminance("")).toBeNull();
    expect(parseLuminance("   ")).toBeNull();
  });

  it("returns null on garbage", () => {
    expect(parseLuminance("oops")).toBeNull();
    expect(parseLuminance("#zz")).toBeNull();
    expect(parseLuminance("#abcd")).toBeNull();
    expect(parseLuminance("hsl(0,0%,50%)")).toBeNull();
  });

  it("returns null when a full-length hex has non-hex digits", () => {
    // Right length, but `parseInt` yields NaN for each channel.
    expect(parseLuminance("#gggggg")).toBeNull();
  });

  it("parses #rgb (short hex)", () => {
    // #000 → 0
    expect(parseLuminance("#000")).toBe(0);
    // #fff → 1
    expect(parseLuminance("#fff")!).toBeCloseTo(1, 4);
  });

  it("parses #rrggbb (long hex)", () => {
    expect(parseLuminance("#000000")).toBe(0);
    expect(parseLuminance("#ffffff")!).toBeCloseTo(1, 4);
    // Pure red ~ 0.2126
    expect(parseLuminance("#ff0000")!).toBeCloseTo(0.2126, 3);
    // Pure green ~ 0.7152
    expect(parseLuminance("#00ff00")!).toBeCloseTo(0.7152, 3);
    // Pure blue ~ 0.0722
    expect(parseLuminance("#0000ff")!).toBeCloseTo(0.0722, 3);
  });

  it("parses #rrggbbaa by ignoring the alpha byte", () => {
    expect(parseLuminance("#ffffff00")!).toBeCloseTo(1, 4);
    expect(parseLuminance("#000000ff")).toBe(0);
  });

  it("parses rgb() and rgba()", () => {
    expect(parseLuminance("rgb(0, 0, 0)")).toBe(0);
    expect(parseLuminance("rgb(255, 255, 255)")!).toBeCloseTo(1, 4);
    expect(parseLuminance("rgba(255 0 0 / 1)")!).toBeCloseTo(0.2126, 3);
    expect(parseLuminance("rgba(0,0,255,0.5)")!).toBeCloseTo(0.0722, 3);
  });
});

describe("applyTheme", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-emr-theme");
  });

  it("sets the data-emr-theme attribute on <html> for a known theme", () => {
    // Real theme ids so the resolved light/dark styling is applied, not just
    // the attribute write.
    applyTheme("light");
    expect(document.documentElement.getAttribute("data-emr-theme")).toBe(
      "light",
    );
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-emr-theme")).toBe(
      "dark",
    );
  });

  it("writes an unknown theme id through to the attribute without throwing", () => {
    // The function is typed against EmrTheme; cast through unknown so we can
    // pass an unrecognized id. An unknown theme still writes through to the
    // attribute without throwing (it just resolves to a light default). The
    // markdown-darkness side-effect (setMarkdownDark(false)) is a
    // stylesheet swap that resolves to empty under vitest's `?raw`
    // handling, so it's not observable here — we assert only the
    // attribute write-through, which is the testable contract.
    applyTheme(
      "brand-new-theme" as unknown as Parameters<typeof applyTheme>[0],
    );
    expect(document.documentElement.getAttribute("data-emr-theme")).toBe(
      "brand-new-theme",
    );
  });
});

describe("syncHostTheme", () => {
  let disconnect: () => void = () => {};

  afterEach(() => {
    disconnect();
  });

  it("returns an unsubscribe function and disconnects without throwing", () => {
    const stop = syncHostTheme();
    expect(typeof stop).toBe("function");
    disconnect = stop;
    expect(() => stop()).not.toThrow();
  });

  it("re-evaluates when body attributes mutate", async () => {
    // Provide a deterministic computed background via stubbing
    // getComputedStyle. We use a 'spy' rather than vi.stubGlobal to
    // restore the jsdom default cleanly.
    const original = globalThis.getComputedStyle;
    let lumaSignal = "rgb(255, 255, 255)"; // light
    const stub = vi.fn((_el: Element) => ({
      getPropertyValue: (prop: string) =>
        prop === "--background-color" ? lumaSignal : "",
      backgroundColor: lumaSignal,
    })) as unknown as typeof getComputedStyle;
    globalThis.getComputedStyle = stub;

    try {
      const stop = syncHostTheme();
      disconnect = stop;
      // Initial pass evaluates light → no `data-emr-markdown-theme` darkness.
      // Flip to a dark colour and trigger a body class mutation.
      lumaSignal = "rgb(10, 10, 10)";
      document.body.className = "vss-theme-dark";
      // MutationObserver in jsdom is async (microtask).
      await new Promise((resolve) => queueMicrotask(resolve));
      // The managed <style> tag should now be installed.
      const styleEl = document.head.querySelector(
        "style[data-emr-markdown-theme]",
      );
      expect(styleEl).not.toBeNull();
    } finally {
      globalThis.getComputedStyle = original;
    }
  });

  it("re-evaluates when a watched media query fires its change event", () => {
    // Capture the `change` listeners syncHostTheme registers on each media
    // query so we can fire one directly — this exercises the live-update
    // handler that flips the theme when the OS toggles colour scheme.
    const changeHandlers: Array<() => void> = [];
    const originalMM = (window as { matchMedia?: typeof window.matchMedia })
      .matchMedia;
    (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia =
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        addEventListener: (_type: string, cb: () => void) =>
          changeHandlers.push(cb),
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;

    let lumaForHandlerTest = "rgb(255, 255, 255)"; // light at registration
    const restoreCS = stubComputedBackground(() => lumaForHandlerTest);
    try {
      const stop = syncHostTheme();
      disconnect = stop;
      expect(changeHandlers.length).toBeGreaterThan(0);
      document.documentElement.removeAttribute("data-emr-theme");
      // Flip the host to dark, then fire the captured media-query change.
      lumaForHandlerTest = "rgb(10, 10, 10)";
      changeHandlers.forEach((h) => h());
      expect(document.documentElement.getAttribute("data-emr-theme")).toBe(
        "dark",
      );
    } finally {
      restoreCS();
      if (originalMM) {
        (window as { matchMedia?: typeof window.matchMedia }).matchMedia =
          originalMM;
      } else {
        delete (window as { matchMedia?: typeof window.matchMedia }).matchMedia;
      }
    }
  });
});

// Helpers shared by the high-contrast / live-update tests below.
function stubComputedBackground(
  getColor: () => string,
  getPrimary: () => string = () => "",
): () => void {
  const original = globalThis.getComputedStyle;
  globalThis.getComputedStyle = vi.fn((_el: Element) => ({
    getPropertyValue: (prop: string) =>
      prop === "--background-color"
        ? getColor()
        : prop === "--palette-primary"
          ? getPrimary()
          : "",
    backgroundColor: getColor(),
  })) as unknown as typeof getComputedStyle;
  return () => {
    globalThis.getComputedStyle = original;
  };
}

function stubMatchMedia(
  isForced: () => boolean,
  prefersDark: () => boolean = () => false,
): () => void {
  const original = (window as { matchMedia?: typeof window.matchMedia })
    .matchMedia;
  (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia =
    vi.fn((query: string) => ({
      matches: query.includes("forced-colors")
        ? isForced()
        : query.includes("prefers-color-scheme: dark")
          ? prefersDark()
          : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  return () => {
    if (original) {
      (window as { matchMedia?: typeof window.matchMedia }).matchMedia =
        original;
    } else {
      delete (window as { matchMedia?: typeof window.matchMedia }).matchMedia;
    }
  };
}

describe("resolveHostTheme", () => {
  it("mirrors dark/light by background luminance when not high-contrast", () => {
    const restoreCS = stubComputedBackground(() => "rgb(255, 255, 255)");
    const restoreMM = stubMatchMedia(() => false);
    try {
      expect(resolveHostTheme()).toBe("light");
    } finally {
      restoreCS();
      restoreMM();
    }

    const restoreCS2 = stubComputedBackground(() => "rgb(10, 10, 10)");
    const restoreMM2 = stubMatchMedia(() => false);
    try {
      expect(resolveHostTheme()).toBe("dark");
    } finally {
      restoreCS2();
      restoreMM2();
    }
  });

  it("upgrades to the high-contrast palette under forced-colors, taking dark/light from prefers-color-scheme", () => {
    // Real ADO behaviour: under forced-colors the host FREEZES the injected
    // `--background-color` at the pre-HC theme's value (light here), so the
    // background can't tell HC-dark from HC-light. Darkness must come from the
    // OS `prefers-color-scheme`. Regression guard for the bug where a dark
    // high-contrast desktop resolved to `hc-light` (white) because the frozen
    // background read as light.
    const restoreCS = stubComputedBackground(() => "rgb(255, 255, 255)");
    const restoreMM = stubMatchMedia(
      () => true,
      () => true,
    );
    try {
      expect(resolveHostTheme()).toBe("hc-dark");
    } finally {
      restoreCS();
      restoreMM();
    }

    const restoreCS2 = stubComputedBackground(() => "rgb(255, 255, 255)");
    const restoreMM2 = stubMatchMedia(
      () => true,
      () => false,
    );
    try {
      expect(resolveHostTheme()).toBe("hc-light");
    } finally {
      restoreCS2();
      restoreMM2();
    }
  });

  it("upgrades to hc-light when ADO's picker mirrors an achromatic primary (forced-colors stays false)", () => {
    // ADO's in-app HC theme is delivered as CSS vars, not OS forced-colors: the
    // accent collapses to grey (`--palette-primary` 0,0,0) and a real HC
    // background is injected, so luminance still resolves light vs dark.
    const restoreCS = stubComputedBackground(
      () => "rgb(255, 255, 255)",
      () => "0, 0, 0",
    );
    const restoreMM = stubMatchMedia(() => false);
    try {
      expect(resolveHostTheme()).toBe("hc-light");
    } finally {
      restoreCS();
      restoreMM();
    }
  });

  it("upgrades to hc-dark when the achromatic primary sits on a dark background", () => {
    const restoreCS = stubComputedBackground(
      () => "rgb(0, 0, 0)",
      () => "255, 255, 255",
    );
    const restoreMM = stubMatchMedia(() => false);
    try {
      expect(resolveHostTheme()).toBe("hc-dark");
    } finally {
      restoreCS();
      restoreMM();
    }
  });

  it("stays on the regular palette when the primary is coloured", () => {
    const restoreCS = stubComputedBackground(
      () => "rgb(255, 255, 255)",
      () => "0, 120, 212",
    );
    const restoreMM = stubMatchMedia(() => false);
    try {
      expect(resolveHostTheme()).toBe("light");
    } finally {
      restoreCS();
      restoreMM();
    }
  });
});

describe("refreshHostTheme", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-emr-theme");
  });

  it("re-mirrors the host theme onto <html> on demand", () => {
    const restoreCS = stubComputedBackground(() => "rgb(12, 12, 12)");
    const restoreMM = stubMatchMedia(() => false);
    try {
      refreshHostTheme();
      expect(document.documentElement.getAttribute("data-emr-theme")).toBe(
        "dark",
      );
      const styleEl = document.head.querySelector(
        "style[data-emr-markdown-theme]",
      );
      expect(styleEl).not.toBeNull();
    } finally {
      restoreCS();
      restoreMM();
    }
  });
});

describe("syncHostTheme — live themeApplied trigger", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-emr-theme");
  });

  it("re-evaluates when the SDK dispatches a themeApplied event", () => {
    let signal = "rgb(255, 255, 255)"; // light
    const restoreCS = stubComputedBackground(() => signal);
    const restoreMM = stubMatchMedia(() => false);
    const stop = syncHostTheme();
    try {
      expect(document.documentElement.getAttribute("data-emr-theme")).toBe(
        "light",
      );
      // Host flips to dark and the SDK re-applies the theme: a reload is
      // NOT required — the themeApplied window event drives the re-sync.
      signal = "rgb(8, 8, 8)";
      window.dispatchEvent(new Event("themeApplied"));
      expect(document.documentElement.getAttribute("data-emr-theme")).toBe(
        "dark",
      );
    } finally {
      stop();
      restoreCS();
      restoreMM();
    }
  });
});

describe("theme resolution under hostile environments", () => {
  it("treats the host as light when getComputedStyle throws", () => {
    const original = globalThis.getComputedStyle;
    globalThis.getComputedStyle = (() => {
      throw new Error("detached frame");
    }) as unknown as typeof getComputedStyle;
    const restoreMM = stubMatchMedia(() => false);
    try {
      expect(resolveHostTheme()).toBe("light");
    } finally {
      globalThis.getComputedStyle = original;
      restoreMM();
    }
  });

  it("still subscribes (and cleans up) when matchMedia throws", () => {
    const original = (window as { matchMedia?: typeof window.matchMedia })
      .matchMedia;
    (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia =
      (() => {
        throw new Error("unsupported query");
      }) as unknown as typeof window.matchMedia;
    try {
      let stop: () => void = () => {};
      expect(() => {
        stop = syncHostTheme();
      }).not.toThrow();
      expect(typeof stop).toBe("function");
      expect(() => stop()).not.toThrow();
    } finally {
      if (original) {
        (window as { matchMedia?: typeof window.matchMedia }).matchMedia =
          original;
      } else {
        delete (window as { matchMedia?: typeof window.matchMedia }).matchMedia;
      }
      document.documentElement.removeAttribute("data-emr-theme");
    }
  });

  it("treats the host as light when matchMedia is unavailable", () => {
    // `isForcedColors` bails out (returning false) when `matchMedia` is not a
    // function, so the result is driven purely by background luminance.
    const restoreCS = stubComputedBackground(() => "rgb(255, 255, 255)");
    const original = (window as { matchMedia?: typeof window.matchMedia })
      .matchMedia;
    delete (window as { matchMedia?: typeof window.matchMedia }).matchMedia;
    try {
      expect(resolveHostTheme()).toBe("light");
    } finally {
      if (original) {
        (window as { matchMedia?: typeof window.matchMedia }).matchMedia =
          original;
      }
      restoreCS();
    }
  });

  it("treats the host as light when getComputedStyle is unavailable", () => {
    // `isHostDark` returns false when `getComputedStyle` is not a function.
    const original = globalThis.getComputedStyle;
    (
      globalThis as { getComputedStyle?: typeof getComputedStyle }
    ).getComputedStyle = undefined;
    const restoreMM = stubMatchMedia(() => false);
    try {
      expect(resolveHostTheme()).toBe("light");
    } finally {
      globalThis.getComputedStyle = original;
      restoreMM();
    }
  });
});

describe("theme — non-DOM safety", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applyTheme is a no-op when there is no document", () => {
    vi.stubGlobal("document", undefined);
    expect(() => applyTheme("light")).not.toThrow();
  });

  it("refreshHostTheme is a no-op when there is no document", () => {
    vi.stubGlobal("document", undefined);
    expect(() => refreshHostTheme()).not.toThrow();
  });

  it("syncHostTheme returns a safe no-op unsubscribe when there is no document", () => {
    vi.stubGlobal("document", undefined);
    const stop = syncHostTheme();
    expect(typeof stop).toBe("function");
    expect(() => stop()).not.toThrow();
  });
});
