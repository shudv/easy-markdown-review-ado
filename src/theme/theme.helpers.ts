// Pure theme logic — extracted from `theme.ts` so it can be unit-tested and
// mutation-tested without pulling in the `?raw` CSS imports (via
// `markdownStyles`) that break Vitest's module-graph tracing. The DOM/SDK glue
// (applyTheme, syncHostTheme, getComputedStyle probing) stays in `theme.ts`.

/** The four palettes we support — mirrors what ADO exposes. */
export type EmrTheme = "light" | "dark" | "hc-light" | "hc-dark";

export interface EmrThemeInfo {
  id: EmrTheme;
  label: string;
  /** True for the two dark palettes. */
  isDark: boolean;
}

export const ALL_THEMES: ReadonlyArray<EmrThemeInfo> = [
  { id: "light", label: "Light", isDark: false },
  { id: "dark", label: "Dark", isDark: true },
  { id: "hc-light", label: "High contrast — light", isDark: false },
  { id: "hc-dark", label: "High contrast — dark", isDark: true },
];

const THEME_IDS: ReadonlySet<EmrTheme> = new Set(ALL_THEMES.map((t) => t.id));

/** True if `s` is one of the four supported `EmrTheme` literals. */
export function isEmrTheme(s: unknown): s is EmrTheme {
  // Stryker disable next-line ConditionalExpression: the `typeof` guard is
  // equivalent under mutation — THEME_IDS holds only strings, so
  // `.has(nonString)` is always false regardless of the type check.
  return typeof s === "string" && THEME_IDS.has(s as EmrTheme);
}

/** The `isDark` flag for a theme id, defaulting to light for unknown ids. */
export function isDarkTheme(theme: string): boolean {
  return ALL_THEMES.find((t) => t.id === theme)?.isDark ?? false;
}

/**
 * Resolve the palette from the two host signals: background darkness picks
 * dark vs light, and forced-colors mode upgrades to the matching
 * high-contrast palette.
 */
export function pickTheme(isDark: boolean, forcedColors: boolean): EmrTheme {
  if (forcedColors) return isDark ? "hc-dark" : "hc-light";
  return isDark ? "dark" : "light";
}

/**
 * True when ADO's mirrored `--palette-primary` triplet ("r, g, b") is achromatic
 * (R==G==B). ADO's in-app high-contrast themes strip the accent to pure
 * black/white, so the primary reads grey; regular themes keep a coloured accent
 * (e.g. `0, 120, 212`). This is the only high-contrast signal ADO's picker
 * exposes to the iframe — `forced-colors` stays false for a picker-chosen HC
 * theme, and the host injects no theme class the sandboxed iframe can read.
 */
export function isHighContrastPrimary(primary: string): boolean {
  const m = primary.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return false;
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  return r === g && g === b;
}

/** Rec.709 luminance threshold below which a background reads as "dark". */
export const DARK_LUMA_THRESHOLD = 0.5;

/** True when a parsed luminance is present and below the dark threshold. */
export function isDarkLuminance(luma: number | null): boolean {
  return luma !== null && luma < DARK_LUMA_THRESHOLD;
}

/**
 * Parse a CSS colour (`#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`) into
 * a 0–1 relative luminance, or null on miss.
 */
export function parseLuminance(color: string): number | null {
  // Stryker disable next-line ConditionalExpression: equivalent mutant — the
  // only falsy string is "", which also yields null via the no-match path
  // below, so removing this fast-path guard doesn't change the result.
  if (!color) return null;
  const s = color.trim();
  let r: number, g: number, b: number;

  if (s.startsWith("#")) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      r = parseInt(hex[0]! + hex[0]!, 16);
      g = parseInt(hex[1]! + hex[1]!, 16);
      b = parseInt(hex[2]! + hex[2]!, 16);
    } else if (hex.length === 6 || hex.length === 8) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    } else {
      return null;
    }
  } else {
    const m = s.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    if (!m) return null;
    r = parseInt(m[1]!, 10);
    g = parseInt(m[2]!, 10);
    b = parseInt(m[3]!, 10);
  }

  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
