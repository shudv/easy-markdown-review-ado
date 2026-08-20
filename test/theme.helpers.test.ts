// Unit + mutation tests for the pure theme logic in `theme.helpers.ts`.
// These import the helpers module directly (no `?raw` CSS deps) so Stryker's
// vitest related-mode can trace the test → source link. DOM/SDK glue lives in
// `theme.ts` and is exercised by `theme.test.ts`.

import { describe, expect, it } from "vitest";

import {
  ALL_THEMES,
  DARK_LUMA_THRESHOLD,
  isDarkLuminance,
  isDarkTheme,
  isEmrTheme,
  isHighContrastPrimary,
  parseLuminance,
  pickTheme,
  type EmrTheme,
} from "../src/theme/theme.helpers";

describe("isEmrTheme", () => {
  it("accepts each declared theme id", () => {
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
    expect(isEmrTheme({ id: "light" })).toBe(false);
  });
});

describe("ALL_THEMES", () => {
  it("declares exactly the four palettes with correct darkness", () => {
    expect(ALL_THEMES.map((t) => t.id)).toEqual([
      "light",
      "dark",
      "hc-light",
      "hc-dark",
    ]);
    expect(ALL_THEMES.map((t) => t.isDark)).toEqual([false, true, false, true]);
  });

  it("gives every theme a non-empty label", () => {
    for (const t of ALL_THEMES) {
      expect(t.label.length).toBeGreaterThan(0);
    }
  });
});

describe("isDarkTheme", () => {
  it("returns the declared darkness for each known theme", () => {
    expect(isDarkTheme("light")).toBe(false);
    expect(isDarkTheme("dark")).toBe(true);
    expect(isDarkTheme("hc-light")).toBe(false);
    expect(isDarkTheme("hc-dark")).toBe(true);
  });

  it("defaults to light (false) for an unknown theme id", () => {
    expect(isDarkTheme("brand-new")).toBe(false);
    expect(isDarkTheme("")).toBe(false);
  });
});

describe("pickTheme", () => {
  it("maps the four (isDark × forcedColors) combinations", () => {
    expect(pickTheme(false, false)).toBe<EmrTheme>("light");
    expect(pickTheme(true, false)).toBe<EmrTheme>("dark");
    expect(pickTheme(false, true)).toBe<EmrTheme>("hc-light");
    expect(pickTheme(true, true)).toBe<EmrTheme>("hc-dark");
  });
});

describe("isHighContrastPrimary", () => {
  it("is true for an achromatic primary (ADO's HC accent is grey/black/white)", () => {
    expect(isHighContrastPrimary("0, 0, 0")).toBe(true);
    expect(isHighContrastPrimary("255, 255, 255")).toBe(true);
    expect(isHighContrastPrimary("128, 128, 128")).toBe(true);
  });

  it("is false for a coloured primary (regular ADO themes)", () => {
    expect(isHighContrastPrimary("0, 120, 212")).toBe(false);
    expect(isHighContrastPrimary("255, 255, 254")).toBe(false);
  });

  it("is false when no rgb triplet is present", () => {
    expect(isHighContrastPrimary("")).toBe(false);
    expect(isHighContrastPrimary("transparent")).toBe(false);
  });
});

describe("isDarkLuminance", () => {
  it("treats null (unparseable) as not dark", () => {
    expect(isDarkLuminance(null)).toBe(false);
  });

  it("is dark strictly below the threshold and light at/above it", () => {
    expect(isDarkLuminance(0)).toBe(true);
    expect(isDarkLuminance(DARK_LUMA_THRESHOLD - 0.01)).toBe(true);
    // Boundary: exactly at the threshold is NOT dark (strict `<`).
    expect(isDarkLuminance(DARK_LUMA_THRESHOLD)).toBe(false);
    expect(isDarkLuminance(DARK_LUMA_THRESHOLD + 0.01)).toBe(false);
    expect(isDarkLuminance(1)).toBe(false);
  });

  it("uses a 0.5 threshold", () => {
    expect(DARK_LUMA_THRESHOLD).toBe(0.5);
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
    expect(parseLuminance("#gggggg")).toBeNull();
  });

  it("returns null when only some channels are non-hex (not all NaN)", () => {
    // Red is NaN but green/blue parse — the guard must reject if ANY channel
    // is NaN, not only when every channel is.
    expect(parseLuminance("#gg0000")).toBeNull();
    expect(parseLuminance("#00gg00")).toBeNull();
    expect(parseLuminance("#0000gg")).toBeNull();
  });

  it("returns null for hex of an unsupported length (not 3/6/8)", () => {
    expect(parseLuminance("#12345")).toBeNull(); // 5
    expect(parseLuminance("#1234567")).toBeNull(); // 7
    expect(parseLuminance("#1")).toBeNull(); // 1
    expect(parseLuminance("#123456789")).toBeNull(); // 9
  });

  it("parses #rgb (short hex)", () => {
    expect(parseLuminance("#000")).toBe(0);
    expect(parseLuminance("#fff")!).toBeCloseTo(1, 4);
    // A short hex expands each nibble: #abc → #aabbcc.
    expect(parseLuminance("#abc")!).toBeCloseTo(
      (0.2126 * 0xaa + 0.7152 * 0xbb + 0.0722 * 0xcc) / 255,
      6,
    );
  });

  it("parses #rrggbb (long hex) with correct per-channel weighting", () => {
    expect(parseLuminance("#000000")).toBe(0);
    expect(parseLuminance("#ffffff")!).toBeCloseTo(1, 4);
    // Pure red / green / blue exercise each coefficient distinctly, killing
    // channel-swap and coefficient mutations.
    expect(parseLuminance("#ff0000")!).toBeCloseTo(0.2126, 4);
    expect(parseLuminance("#00ff00")!).toBeCloseTo(0.7152, 4);
    expect(parseLuminance("#0000ff")!).toBeCloseTo(0.0722, 4);
  });

  it("weights green > red > blue (distinguishes the coefficients)", () => {
    const red = parseLuminance("#ff0000")!;
    const green = parseLuminance("#00ff00")!;
    const blue = parseLuminance("#0000ff")!;
    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
  });

  it("uses the correct channel for each hex pair (not swapped)", () => {
    // 0x80 in the red slot only.
    const rOnly = parseLuminance("#800000")!;
    expect(rOnly).toBeCloseTo((0.2126 * 0x80) / 255, 6);
    // 0x80 in the green slot only.
    const gOnly = parseLuminance("#008000")!;
    expect(gOnly).toBeCloseTo((0.7152 * 0x80) / 255, 6);
    // 0x80 in the blue slot only.
    const bOnly = parseLuminance("#000080")!;
    expect(bOnly).toBeCloseTo((0.0722 * 0x80) / 255, 6);
  });

  it("parses #rrggbbaa by ignoring the alpha byte", () => {
    expect(parseLuminance("#ffffff00")!).toBeCloseTo(1, 4);
    expect(parseLuminance("#000000ff")).toBe(0);
    // Alpha must not affect the result: same RGB, different alpha.
    expect(parseLuminance("#12345600")).toBeCloseTo(
      parseLuminance("#123456ff")!,
      10,
    );
  });

  it("parses rgb() and rgba() in comma and space syntaxes", () => {
    expect(parseLuminance("rgb(0, 0, 0)")).toBe(0);
    expect(parseLuminance("rgb(255, 255, 255)")!).toBeCloseTo(1, 4);
    expect(parseLuminance("rgba(255 0 0 / 1)")!).toBeCloseTo(0.2126, 4);
    expect(parseLuminance("rgba(0,0,255,0.5)")!).toBeCloseTo(0.0722, 4);
  });

  it("normalizes to 0–1 by dividing the weighted sum by 255", () => {
    // A mid grey rgb(128,128,128) → 128/255 regardless of channel weights
    // (they sum to 1), pinning the /255 normalization.
    expect(parseLuminance("rgb(128,128,128)")!).toBeCloseTo(128 / 255, 10);
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(parseLuminance("  #000000  ")).toBe(0);
    expect(parseLuminance("\t#ffffff\n")!).toBeCloseTo(1, 4);
  });
});
