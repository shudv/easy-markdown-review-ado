import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  READER_FONTS,
  DEFAULT_FONT_ID,
  READER_PERCENT_MIN,
  READER_PERCENT_MAX,
  READER_SPACING_UI_MIN,
  READER_SPACING_UI_MAX,
  DEFAULT_SIZE_PCT,
  DEFAULT_LINE_SPACING_PCT,
  DEFAULT_PARAGRAPH_SPACING_PCT,
  DEFAULT_LETTER_SPACING_PCT,
  DEFAULT_WORD_SPACING_PCT,
  NAV_WIDTH_MIN_PCT,
  NAV_WIDTH_MAX_PCT,
  COMMENT_WIDTH_MIN_PCT,
  DEFAULT_NAV_WIDTH_PCT,
  DEFAULT_COMMENT_WIDTH_PCT,
  DEFAULT_READER_PREFS,
  READER_TYPE_KEY,
  detectAvailableReaderFonts,
  layoutStorageKey,
  resolveReaderFont,
  clampReaderPct,
  snapReaderPct,
  nudgeReaderPct,
  readerSpacingValues,
  clampNavWidthPct,
  clampCommentWidthPct,
  widthScale,
  PANE_CLOSE_AT_PCT,
  PANE_REOPEN_TRIGGER_PX,
  dragClosesPane,
  dragReopensPane,
  sanitizeReaderPrefs,
  readReaderPrefs,
  writeReaderPrefs,
  readerMinWidth,
  maxRailWidthPct,
} from "../src/shell/readerPrefs";

const spacingPrefs = (pct: number) => ({
  lineSpacingPct: pct,
  paragraphSpacingPct: pct,
  letterSpacingPct: pct,
  wordSpacingPct: pct,
});

describe("readerPrefs — curated font list", () => {
  it("puts the default (system) font first so it is the fallback", () => {
    expect(READER_FONTS[0]!.id).toBe(DEFAULT_FONT_ID);
    expect(READER_FONTS.map((font) => font.id)).toEqual([
      "system",
      "atkinson",
      "sitka",
      "georgia",
      "verdana",
    ]);
  });

  it("resolves a known font id to its definition", () => {
    expect(resolveReaderFont("sitka").name).toBe("Sitka");
    expect(resolveReaderFont("atkinson").name).toBe("Atkinson Hyperlegible");
  });

  it("falls back to the default font for unknown and removed ids", () => {
    expect(resolveReaderFont("does-not-exist")).toBe(READER_FONTS[0]);
    expect(resolveReaderFont("palatino")).toBe(READER_FONTS[0]);
    expect(resolveReaderFont("").id).toBe(DEFAULT_FONT_ID);
  });

  it("keeps System plus only locally available curated fonts", async () => {
    const available = await detectAvailableReaderFonts(async (family) =>
      ["Sitka Text", "Verdana"].includes(family),
    );
    expect(available.map((font) => font.id)).toEqual([
      "system",
      "sitka",
      "verdana",
    ]);
  });

  it("keeps only System when font availability cannot be checked", async () => {
    expect(
      (
        await detectAvailableReaderFonts(async () => {
          throw new Error("font check unavailable");
        })
      ).map((font) => font.id),
    ).toEqual(["system"]);
  });
});

describe("readerPrefs — continuous reader percentages", () => {
  it("rounds and clamps arbitrary percentages", () => {
    expect(clampReaderPct(100)).toBe(100);
    expect(clampReaderPct(108.4)).toBe(108);
    expect(clampReaderPct(-50)).toBe(READER_PERCENT_MIN);
    expect(clampReaderPct(9999)).toBe(READER_PERCENT_MAX);
  });

  it("sticks values near the default to exactly 100", () => {
    expect(snapReaderPct(97)).toBe(100);
    expect(snapReaderPct(103)).toBe(100);
    expect(snapReaderPct(96)).toBe(96);
    expect(snapReaderPct(104)).toBe(104);
  });

  it("nudges by five points and clamps at both ends", () => {
    expect(nudgeReaderPct(100, 1)).toBe(105);
    expect(nudgeReaderPct(100, -1)).toBe(95);
    expect(nudgeReaderPct(READER_PERCENT_MAX, 1)).toBe(READER_PERCENT_MAX);
    expect(nudgeReaderPct(READER_PERCENT_MIN, -1)).toBe(READER_PERCENT_MIN);
  });

  it("uses separate 100–200 bounds for spacing percentages", () => {
    expect(
      snapReaderPct(80, READER_SPACING_UI_MIN, READER_SPACING_UI_MAX),
    ).toBe(100);
    expect(
      nudgeReaderPct(195, 1, READER_SPACING_UI_MIN, READER_SPACING_UI_MAX),
    ).toBe(200);
    expect(
      nudgeReaderPct(200, 1, READER_SPACING_UI_MIN, READER_SPACING_UI_MAX),
    ).toBe(200);
  });

  it("maps a coupled 125% to a conservative general-purpose balance", () => {
    expect(readerSpacingValues(spacingPrefs(125))).toEqual({
      lineHeight: 1.675,
      letterSpacingEm: 0.02,
      wordSpacingEm: 0.04,
      paragraphSpacingPx: 17.6,
    });
  });

  it("resolves independently persisted spacing dimensions", () => {
    expect(
      readerSpacingValues({
        lineSpacingPct: 125,
        paragraphSpacingPct: 100,
        letterSpacingPct: 100,
        wordSpacingPct: 100,
      }),
    ).toEqual({
      lineHeight: 1.675,
      paragraphSpacingPx: 16,
      letterSpacingEm: 0,
      wordSpacingEm: 0,
    });
  });

  it("resolves the spacing ceiling without size-range clamping", () => {
    expect(readerSpacingValues(spacingPrefs(200))).toEqual({
      lineHeight: 1.9,
      paragraphSpacingPx: 22.4,
      letterSpacingEm: 0.08,
      wordSpacingEm: 0.16,
    });
  });
});

describe("readerPrefs — nav-width resizing", () => {
  it("clamps a (drag-derived) percentage into the range, rounded", () => {
    expect(clampNavWidthPct(100)).toBe(100);
    expect(clampNavWidthPct(108.4)).toBe(108); // continuous — just rounded
    expect(clampNavWidthPct(-50)).toBe(NAV_WIDTH_MIN_PCT);
    expect(clampNavWidthPct(9999)).toBe(NAV_WIDTH_MAX_PCT);
  });

  it("floors the comment rail higher than the nav (cramped when too narrow)", () => {
    expect(COMMENT_WIDTH_MIN_PCT).toBeGreaterThan(NAV_WIDTH_MIN_PCT);
    expect(clampCommentWidthPct(100)).toBe(100); // in range → unchanged
    expect(clampCommentWidthPct(108.4)).toBe(108); // continuous — just rounded
    expect(clampCommentWidthPct(60)).toBe(COMMENT_WIDTH_MIN_PCT); // below floor
    expect(clampCommentWidthPct(9999)).toBe(NAV_WIDTH_MAX_PCT); // capped
  });
});

describe("readerPrefs — widthScale (CSS scale guard)", () => {
  it("maps an in-range pct to a 0.5–1.3 factor", () => {
    expect(widthScale(100)).toBe(1);
    expect(widthScale(50)).toBeCloseTo(0.5, 5);
    expect(widthScale(130)).toBeCloseTo(1.3, 5);
  });

  it("clamps an out-of-range pct so a pane can't balloon or collapse", () => {
    expect(widthScale(500)).toBeCloseTo(1.3, 5); // capped at +30%
    expect(widthScale(10)).toBeCloseTo(0.5, 5); // floored at -50%
  });

  it("falls back to 1 for a non-finite pct (never emits NaN into CSS)", () => {
    expect(widthScale(NaN)).toBe(1);
    expect(widthScale(Infinity)).toBe(1);
    expect(widthScale(undefined as unknown as number)).toBe(1);
  });
});

describe("readerPrefs — drag-to-close / reopen thresholds", () => {
  it("auto-closes a pane only once the drag target drops below the floor", () => {
    expect(PANE_CLOSE_AT_PCT).toBe(45);
    expect(dragClosesPane(44)).toBe(true); // just under → collapse
    expect(dragClosesPane(0)).toBe(true); // dragged to closure
    expect(dragClosesPane(45)).toBe(false); // exactly at the threshold → stay open
    expect(dragClosesPane(50)).toBe(false); // at the min width → stay open
  });

  it("reopens a closed pane only past the inward-grab trigger", () => {
    expect(PANE_REOPEN_TRIGGER_PX).toBe(24);
    expect(dragReopensPane(24)).toBe(true); // exactly at trigger → reopen
    expect(dragReopensPane(40)).toBe(true); // well past → reopen
    expect(dragReopensPane(23)).toBe(false); // just short → stay closed
    expect(dragReopensPane(0)).toBe(false); // no inward travel → stay closed
  });
});

describe("readerPrefs — sanitize", () => {
  it("returns a fresh copy of the defaults for non-object input", () => {
    expect(sanitizeReaderPrefs(null)).toEqual(DEFAULT_READER_PREFS);
    expect(sanitizeReaderPrefs(undefined)).toEqual(DEFAULT_READER_PREFS);
    expect(sanitizeReaderPrefs(42)).toEqual(DEFAULT_READER_PREFS);
    expect(sanitizeReaderPrefs("nope")).toEqual(DEFAULT_READER_PREFS);
    // A fresh object, not the shared default reference.
    expect(sanitizeReaderPrefs(null)).not.toBe(DEFAULT_READER_PREFS);
  });

  it("keeps valid fields and snaps the size + rail widths", () => {
    expect(
      sanitizeReaderPrefs({
        fontId: "atkinson",
        sizePct: 132,
        lineSpacingPct: 124.6,
        paragraphSpacingPct: 111.2,
        letterSpacingPct: 96,
        wordSpacingPct: 103,
        showNav: false,
        showComments: false,
        navWidthPct: 120,
        commentWidthPct: 85,
      }),
    ).toEqual({
      fontId: "atkinson",
      sizePct: 132,
      lineSpacingPct: 125,
      paragraphSpacingPct: 111,
      letterSpacingPct: 100,
      wordSpacingPct: 100,
      showNav: false,
      showComments: false,
      navWidthPct: 120,
      commentWidthPct: 85,
    });
  });

  it("clamps an out-of-range comment/nav width so a pane can't balloon", () => {
    expect(sanitizeReaderPrefs({ commentWidthPct: 500 }).commentWidthPct).toBe(
      NAV_WIDTH_MAX_PCT,
    );
    expect(sanitizeReaderPrefs({ navWidthPct: 500 }).navWidthPct).toBe(
      NAV_WIDTH_MAX_PCT,
    );
  });

  it("coerces each invalid field back to its default", () => {
    const out = sanitizeReaderPrefs({
      fontId: "unknown",
      sizePct: "big",
      lineSpacingPct: "wide",
      paragraphSpacingPct: null,
      letterSpacingPct: false,
      wordSpacingPct: "wide",
      showNav: "yes",
      showComments: 0,
      navWidthPct: "wide",
      commentWidthPct: "wide",
    });
    expect(out.fontId).toBe(DEFAULT_FONT_ID);
    expect(out.sizePct).toBe(DEFAULT_SIZE_PCT);
    expect(out.lineSpacingPct).toBe(DEFAULT_LINE_SPACING_PCT);
    expect(out.paragraphSpacingPct).toBe(DEFAULT_PARAGRAPH_SPACING_PCT);
    expect(out.letterSpacingPct).toBe(DEFAULT_LETTER_SPACING_PCT);
    expect(out.wordSpacingPct).toBe(DEFAULT_WORD_SPACING_PCT);
    expect(out.showNav).toBe(true);
    expect(out.showComments).toBe(true);
    expect(out.navWidthPct).toBe(DEFAULT_NAV_WIDTH_PCT);
    expect(out.commentWidthPct).toBe(DEFAULT_COMMENT_WIDTH_PCT);
  });

  it("rejects a non-finite size", () => {
    expect(sanitizeReaderPrefs({ sizePct: Number.NaN }).sizePct).toBe(
      DEFAULT_SIZE_PCT,
    );
    expect(sanitizeReaderPrefs({ sizePct: Infinity }).sizePct).toBe(
      DEFAULT_SIZE_PCT,
    );
    expect(
      sanitizeReaderPrefs({ lineSpacingPct: Number.NaN }).lineSpacingPct,
    ).toBe(DEFAULT_LINE_SPACING_PCT);
    expect(
      sanitizeReaderPrefs({ wordSpacingPct: Infinity }).wordSpacingPct,
    ).toBe(DEFAULT_WORD_SPACING_PCT);
  });
});

describe("readerPrefs — persistence + per-surface scoping", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("splits typography (shared key) from layout (per-surface key)", () => {
    const prefs = {
      fontId: "atkinson",
      sizePct: 115,
      ...spacingPrefs(125),
      showNav: false,
      showComments: true,
      navWidthPct: 130,
      commentWidthPct: 90,
    };
    writeReaderPrefs("pr", prefs);
    expect(localStorage.getItem(READER_TYPE_KEY)).not.toBeNull();
    expect(localStorage.getItem(layoutStorageKey("pr"))).not.toBeNull();
    expect(readReaderPrefs("pr")).toEqual(prefs);
    expect(JSON.parse(localStorage.getItem(READER_TYPE_KEY)!)).toEqual({
      fontId: "atkinson",
      sizePct: 115,
      ...spacingPrefs(125),
    });
  });

  it("shares typography across surfaces but keeps layout per-surface", () => {
    // The PR tab hides both panels + widens the nav.
    writeReaderPrefs("pr", {
      fontId: "atkinson",
      sizePct: 130,
      ...spacingPrefs(120),
      showNav: false,
      showComments: false,
      navWidthPct: 130,
      commentWidthPct: 115,
    });
    // The hub inherits the GLOBAL font + size, but its OWN layout is untouched
    // (default panels shown, default rail widths) — the PR tab's focus doesn't
    // bleed across.
    expect(readReaderPrefs("hub")).toEqual({
      fontId: "atkinson",
      sizePct: 130,
      ...spacingPrefs(120),
      showNav: true,
      showComments: true,
      navWidthPct: DEFAULT_NAV_WIDTH_PCT,
      commentWidthPct: DEFAULT_COMMENT_WIDTH_PCT,
    });
    // Changing typography from the hub updates it globally; the PR tab keeps its
    // own layout but now sees the new font/size.
    writeReaderPrefs("hub", {
      fontId: "sitka",
      sizePct: 90,
      ...spacingPrefs(110),
      showNav: true,
      showComments: true,
      navWidthPct: 70,
      commentWidthPct: 70,
    });
    expect(readReaderPrefs("pr")).toEqual({
      fontId: "sitka",
      sizePct: 90,
      ...spacingPrefs(110),
      showNav: false,
      showComments: false,
      navWidthPct: 130,
      commentWidthPct: 115,
    });
  });

  it("returns the defaults when nothing is stored", () => {
    expect(readReaderPrefs("pr")).toEqual(DEFAULT_READER_PREFS);
  });

  it("hydrates the legacy font + size schema with default spacing", () => {
    localStorage.setItem(
      READER_TYPE_KEY,
      JSON.stringify({ fontId: "atkinson", sizePct: 115 }),
    );

    expect(readReaderPrefs("pr")).toEqual({
      ...DEFAULT_READER_PREFS,
      fontId: "atkinson",
      sizePct: 115,
    });
  });

  it("falls back for a removed font and ignores the unshipped composite field", () => {
    localStorage.setItem(
      READER_TYPE_KEY,
      JSON.stringify({ fontId: "palatino", sizePct: 115, spacingPct: 120 }),
    );

    expect(readReaderPrefs("pr")).toEqual({
      ...DEFAULT_READER_PREFS,
      fontId: DEFAULT_FONT_ID,
      sizePct: 115,
    });
  });

  it("degrades to defaults on corrupt JSON in either key", () => {
    localStorage.setItem(READER_TYPE_KEY, "{not json");
    localStorage.setItem(layoutStorageKey("pr"), "{not json");
    expect(readReaderPrefs("pr")).toEqual(DEFAULT_READER_PREFS);
  });

  it("degrades to defaults when reading throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readReaderPrefs("pr")).toEqual(DEFAULT_READER_PREFS);
  });

  it("swallows write failures", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeReaderPrefs("pr", DEFAULT_READER_PREFS)).not.toThrow();
  });
});

describe("readerPrefs — anchored-layout width budget", () => {
  it("sums the visible columns + the document scrollbar", () => {
    // nav 340 + doc 440 + doc bar 12 + rail 340 (native scrollbar inside)
    expect(readerMinWidth(true, true)).toBe(1132);
  });

  it("drops the nav width when the nav is hidden", () => {
    expect(readerMinWidth(false, true)).toBe(792);
  });

  it("drops the rail when comments are hidden", () => {
    expect(readerMinWidth(true, false)).toBe(792);
  });

  it("needs only the document + its scrollbar with both panels hidden", () => {
    expect(readerMinWidth(false, false)).toBe(452);
  });

  it("scales each rail's share by its own width preference", () => {
    // nav 340 × 130% = 442, + doc 440 + doc bar 12 + rail 340 (comment defaults 100%)
    expect(readerMinWidth(true, true, 130)).toBe(442 + 440 + 12 + 340);
    // The comment rail scales INDEPENDENTLY: nav 340 + doc 440 + bar 12 + rail 442.
    expect(readerMinWidth(true, true, 100, 130)).toBe(340 + 440 + 12 + 442);
    // Both scaled at once.
    expect(readerMinWidth(true, true, 130, 70)).toBe(442 + 440 + 12 + 238);
    // A narrower nav lowers the budget (340 × 70% = 238); comments hidden so no rail.
    expect(readerMinWidth(true, false, 70)).toBe(238 + 440 + 12);
    // A hidden nav ignores the nav scale; the comment scale still applies.
    expect(readerMinWidth(false, true, 130, 130)).toBe(440 + 12 + 442);
  });

  it("caps a rail's drag at the space left once the other rail + doc floor fit", () => {
    // Roomy frame → the design max (130%) is the only limit.
    expect(maxRailWidthPct(2000, 340)).toBe(NAV_WIDTH_MAX_PCT);
    // Tight frame → floored to exactly what fits beside a 340px other rail.
    // (1231 − 440 − 12 − 340) / 340 = 129.1% → floor 129.
    expect(maxRailWidthPct(1231, 340)).toBe(129);
    // Too little room → never below the design min (50%).
    expect(maxRailWidthPct(900, 340)).toBe(NAV_WIDTH_MIN_PCT);
    // A wider "other rail" leaves less room for this one.
    // (1231 − 440 − 12 − 442) / 340 = 99.1% → floor 99.
    expect(maxRailWidthPct(1231, 442)).toBe(99);
  });
});
