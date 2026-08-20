// Theme support for the Markdown Review extension.
//
// Two surfaces: a set of `--emr-*` CSS custom properties for chrome (see
// `pr-tab/styles.scss`), and the GitHub Markdown CSS for the article body
// (swapped light/dark by `markdownStyles.setMarkdownDark`). Entry points:
//   * `applyTheme(theme)` — standalone preview; the floating picker switches
//     palette explicitly.
//   * `syncHostTheme()` — production iframe; mirrors the host theme and keeps
//     mirroring on live toggles via the SDK's `themeApplied` event.
//   * `refreshHostTheme()` — manual re-mirror for the Documents hub refresh
//     button (fallback for hosts that don't broadcast live theme changes).

import { setMarkdownDark } from "./markdownStyles";
import {
  isDarkLuminance,
  isDarkTheme,
  isHighContrastPrimary,
  parseLuminance,
  pickTheme,
  type EmrTheme,
} from "./theme.helpers";

// Re-export the pure logic so existing importers (and tests) keep a single
// `./theme` entry point. The pure implementations live in `theme.helpers.ts`
// (no `?raw` CSS deps) so they can be unit- and mutation-tested cleanly.
export {
  ALL_THEMES,
  isEmrTheme,
  parseLuminance,
  type EmrTheme,
  type EmrThemeInfo,
} from "./theme.helpers";

/**
 * Apply a specific theme by name: sets `data-emr-theme` (drives the `--emr-*`
 * overrides) and swaps the markdown stylesheet. Used by the standalone picker.
 */
export function applyTheme(theme: EmrTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-emr-theme", theme);

  setMarkdownDark(isDarkTheme(theme));
}

/**
 * The OS-level colour signals a sandboxed iframe can read via `matchMedia`:
 * forced-colors (Windows High Contrast) and the dark/light preference. Both are
 * read together under one guard; returns all-false outside a DOM context, when
 * `matchMedia` is unavailable, or if a query throws.
 *
 * Why `prefersDark` is needed: under forced-colors the ADO host FREEZES its
 * injected `--background-color` custom property at the pre-HC theme's value
 * (verified against a live host — the standard `background-color` gets forced
 * to the HC colour, but the custom property does not). So background luminance
 * can no longer tell HC-dark from HC-light; the OS colour-scheme preference is
 * the reliable dark/light signal in that mode.
 */
function readHostColorSignals(): { forced: boolean; prefersDark: boolean } {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return { forced: false, prefersDark: false };
  }
  try {
    return {
      forced: window.matchMedia("(forced-colors: active)").matches,
      prefersDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
    };
  } catch {
    return { forced: false, prefersDark: false };
  }
}

/**
 * Resolve the `EmrTheme` that best mirrors the host now. Normally the injected
 * background's luminance picks dark vs light. Under forced-colors the host
 * freezes that background, so the OS colour-scheme preference drives dark vs
 * light instead. High contrast is engaged by EITHER OS forced-colors OR ADO's
 * own picker (which mirrors an achromatic `--palette-primary` but never trips
 * forced-colors). Exported for tests and the refresh-button hook.
 */
export function resolveHostTheme(): EmrTheme {
  const { forced, prefersDark } = readHostColorSignals();
  // ADO's picker HC injects a real HC background, so luminance still tells
  // hc-dark from hc-light there; only OS forced-colors freezes the background.
  const dark = forced ? prefersDark : isHostDark();
  return pickTheme(dark, forced || isAdoHighContrast());
}

/**
 * Apply the host-mirrored theme to the document: swap the markdown
 * stylesheet and write `data-emr-theme` so the `--emr-*` chrome variables
 * flip. Idempotent and safe before the DOM is ready.
 */
function applyHostTheme(): void {
  const theme = resolveHostTheme();
  setMarkdownDark(isDarkTheme(theme));
  // `data-emr-theme` rather than a class so we don't fight ADO's own
  // classes on `<html>`; styles.scss keys its selector on this attribute.
  document.documentElement.setAttribute("data-emr-theme", theme);
}

/**
 * Re-mirror the host theme on demand (Documents hub refresh button). No-op
 * outside a DOM context.
 */
export function refreshHostTheme(): void {
  if (typeof document === "undefined") return;
  applyHostTheme();
}

/**
 * Production sync — mirror the host iframe's theme into our markdown body and
 * chrome, and keep mirroring as the user toggles their ADO theme.
 *
 * With `SDK.init({ applyTheme: true })` the SDK injects the host theme as CSS
 * vars and fires `themeApplied` on `window` on every (re)apply; we use that as
 * the primary live-update trigger (body/html mutations don't fire on a live
 * switch). MutationObserver and media-query listeners are belt-and-braces.
 * Returns an unsubscribe function; safe to call before the DOM is ready.
 */
export function syncHostTheme(): () => void {
  if (typeof document === "undefined") return () => {};

  const evaluate = () => applyHostTheme();
  evaluate();

  const cleanups: Array<() => void> = [];

  // Primary trigger: the SDK dispatches `themeApplied` after applying theme
  // vars (initial handshake and live toggles). Also listen for the raw
  // `themeChanged` in case a host emits it before the SDK relays.
  /* v8 ignore start -- window is always present in the rendered iframe; the absent-window branch is defensive */
  if (
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function"
  ) {
    /* v8 ignore stop */
    const onThemeEvent = () => evaluate();
    window.addEventListener("themeApplied", onThemeEvent);
    window.addEventListener("themeChanged", onThemeEvent);
    cleanups.push(() => {
      window.removeEventListener("themeApplied", onThemeEvent);
      window.removeEventListener("themeChanged", onThemeEvent);
    });
  }

  // `prefers-color-scheme` / `forced-colors` can flip before the host updates
  // the injected CSS vars, giving a faster reaction than the theme event.
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
  ) {
    for (const query of [
      "(prefers-color-scheme: dark)",
      "(forced-colors: active)",
    ]) {
      try {
        const mql = window.matchMedia(query);
        const handler = () => evaluate();
        mql.addEventListener("change", handler);
        cleanups.push(() => mql.removeEventListener("change", handler));
      } catch {
        // matchMedia can throw on unsupported queries; skip this one.
      }
    }
  }

  /* v8 ignore next -- MutationObserver is always defined in the iframe; the absent branch is defensive */
  if (typeof MutationObserver !== "undefined") {
    const observer = new MutationObserver(evaluate);
    /* v8 ignore next -- document.body is always present in the rendered iframe */
    if (document.body) {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    }
    /* v8 ignore next -- document.documentElement is always present in the rendered iframe */
    if (document.documentElement) {
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    }
    cleanups.push(() => observer.disconnect());
  }

  return () => {
    for (const stop of cleanups) stop();
  };
}

/**
 * True if the host background reads as dark (Rec.709 luminance < 50%). Falls
 * back to light outside a DOM context or when no background is resolvable.
 */
function isHostDark(): boolean {
  /* v8 ignore next -- document.body is always present in our rendered iframe */
  if (typeof document === "undefined" || !document.body) return false;
  if (typeof getComputedStyle !== "function") return false;
  try {
    const cs = getComputedStyle(document.body);
    const raw =
      /* v8 ignore start -- the host always exposes --background-color; the raw backgroundColor / empty-string fallbacks are defensive */
      cs.getPropertyValue("--background-color").trim() ||
      cs.backgroundColor ||
      "";
    /* v8 ignore stop */
    return isDarkLuminance(parseLuminance(raw));
  } catch {
    // getComputedStyle can throw in detached frames; treat as light.
    return false;
  }
}

/**
 * True when ADO's picker has a high-contrast theme active, detected from the
 * mirrored achromatic `--palette-primary` (see `isHighContrastPrimary`). Falls
 * back to false outside a DOM context or when the value can't be read.
 */
function isAdoHighContrast(): boolean {
  /* v8 ignore next -- document.body is always present in our rendered iframe */
  if (typeof document === "undefined" || !document.body) return false;
  if (typeof getComputedStyle !== "function") return false;
  try {
    const primary = getComputedStyle(document.body).getPropertyValue(
      "--palette-primary",
    );
    return isHighContrastPrimary(primary);
  } catch {
    return false;
  }
}
