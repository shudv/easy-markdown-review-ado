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
    dragClosesPane,
    dragReopensPane,
    sanitizeReaderPrefs,
    readReaderPrefs,
    writeReaderPrefs,
    readerMinWidth,
    maxRailWidthPct,
} from "../src/shell/readerPrefs";
import { failStorage } from "./readerStorageFailures";

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

    it.each([
        ["system", "System"],
        ["sitka", "Sitka"],
        ["atkinson", "Atkinson Hyperlegible"],
        ["georgia", "Georgia"],
        ["verdana", "Verdana"],
    ])("resolves the font id %s to %s", (id, name) => {
        expect(resolveReaderFont(id).name).toBe(name);
    });

    it.each([
        { id: "system", face: "Segoe UI", generic: "sans-serif" },
        { id: "atkinson", face: "Atkinson Hyperlegible", generic: "sans-serif" },
        { id: "sitka", face: "Sitka Text", generic: "serif" },
        { id: "georgia", face: "Georgia", generic: "serif" },
        { id: "verdana", face: "Verdana", generic: "sans-serif" },
    ])("sets $id prose in $face, falling back to a $generic face", ({ id, face, generic }) => {
        const families = resolveReaderFont(id)
            .stack.split(",")
            .map((family) => family.trim().replace(/"/g, ""));

        expect(families).toContain(face);
        expect(families.at(-1)).toBe(generic);
    });

    it.each([
        { name: "an unknown id", id: "does-not-exist" },
        { name: "a removed font", id: "palatino" },
        { name: "an empty id", id: "" },
    ])("falls back to the default font for $name", ({ id }) => {
        expect(resolveReaderFont(id)).toBe(READER_FONTS[0]);
    });

    it("keeps System plus only locally available curated fonts", async () => {
        const available = await detectAvailableReaderFonts(async (family) =>
            ["Sitka Text", "Verdana"].includes(family),
        );

        expect(available.map((font) => font.id)).toEqual(["system", "sitka", "verdana"]);
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
    it.each([
        { name: "keeps an in-range value", pct: 100, expected: 100 },
        { name: "rounds a fractional value", pct: 108.4, expected: 108 },
        { name: "raises a negative value to the minimum", pct: -50, expected: READER_PERCENT_MIN },
        { name: "caps a huge value at the maximum", pct: 9999, expected: READER_PERCENT_MAX },
    ])("$name", ({ pct, expected }) => {
        expect(clampReaderPct(pct)).toBe(expected);
    });

    it.each([
        { pct: 97, expected: 100 },
        { pct: 103, expected: 100 },
        { pct: 96, expected: 96 },
        { pct: 104, expected: 104 },
    ])("snaps $pct% to $expected% (values near the default stick to 100)", ({ pct, expected }) => {
        expect(snapReaderPct(pct)).toBe(expected);
    });

    it.each([
        { name: "grows by five points", pct: 100, direction: 1, expected: 105 },
        { name: "shrinks by five points", pct: 100, direction: -1, expected: 95 },
        {
            name: "stays at the maximum",
            pct: READER_PERCENT_MAX,
            direction: 1,
            expected: READER_PERCENT_MAX,
        },
        {
            name: "stays at the minimum",
            pct: READER_PERCENT_MIN,
            direction: -1,
            expected: READER_PERCENT_MIN,
        },
    ] as const)("a nudge $name", ({ pct, direction, expected }) => {
        expect(nudgeReaderPct(pct, direction)).toBe(expected);
    });

    it("snaps spacing below its 100% floor up to 100", () => {
        expect(snapReaderPct(80, READER_SPACING_UI_MIN, READER_SPACING_UI_MAX)).toBe(100);
    });

    it.each([
        { name: "reaches", pct: 195 },
        { name: "stays at", pct: 200 },
    ])("a spacing nudge $name the 200% ceiling", ({ pct }) => {
        expect(nudgeReaderPct(pct, 1, READER_SPACING_UI_MIN, READER_SPACING_UI_MAX)).toBe(200);
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
    it.each([
        { name: "keeps an in-range width", pct: 100, expected: 100 },
        { name: "rounds a dragged width", pct: 108.4, expected: 108 },
        { name: "raises a negative width to the minimum", pct: -50, expected: NAV_WIDTH_MIN_PCT },
        { name: "caps a huge width at the maximum", pct: 9999, expected: NAV_WIDTH_MAX_PCT },
    ])("$name", ({ pct, expected }) => {
        expect(clampNavWidthPct(pct)).toBe(expected);
    });

    it("floors the comment rail higher than the nav (cramped when too narrow)", () => {
        expect(COMMENT_WIDTH_MIN_PCT).toBeGreaterThan(NAV_WIDTH_MIN_PCT);
        expect(clampCommentWidthPct(60)).toBe(COMMENT_WIDTH_MIN_PCT);
    });

    it.each([
        { name: "keeps an in-range width", pct: 100, expected: 100 },
        { name: "rounds a dragged width", pct: 108.4, expected: 108 },
        { name: "caps a huge width at the maximum", pct: 9999, expected: NAV_WIDTH_MAX_PCT },
    ])("comment rail: $name", ({ pct, expected }) => {
        expect(clampCommentWidthPct(pct)).toBe(expected);
    });
});

describe("readerPrefs — widthScale (CSS scale guard)", () => {
    it.each([
        { name: "the default width", pct: 100, expected: 1 },
        { name: "the narrowest width", pct: 50, expected: 0.5 },
        { name: "the widest width", pct: 130, expected: 1.3 },
        { name: "a width past the maximum, capped", pct: 500, expected: 1.3 },
        { name: "a width below the minimum, floored", pct: 10, expected: 0.5 },
    ])("scales $name", ({ pct, expected }) => {
        expect(widthScale(pct)).toBeCloseTo(expected, 5);
    });

    it.each([
        { name: "NaN", pct: Number.NaN },
        { name: "Infinity", pct: Infinity },
        { name: "a missing value", pct: undefined as unknown as number },
    ])("never emits NaN into CSS: $name scales by 1", ({ pct }) => {
        expect(widthScale(pct)).toBe(1);
    });
});

describe("readerPrefs — drag-to-close / reopen thresholds", () => {
    it.each([
        { name: "just under the 45% floor closes", pct: 44, expected: true },
        { name: "all the way to zero closes", pct: 0, expected: true },
        { name: "exactly at the floor stays open", pct: 45, expected: false },
        { name: "at the minimum width stays open", pct: 50, expected: false },
    ])("dragging a pane $name", ({ pct, expected }) => {
        expect(dragClosesPane(pct)).toBe(expected);
    });

    it.each([
        { name: "exactly the 24px trigger reopens it", px: 24, expected: true },
        { name: "well past the trigger reopens it", px: 40, expected: true },
        { name: "just short of the trigger keeps it closed", px: 23, expected: false },
        { name: "no inward travel keeps it closed", px: 0, expected: false },
    ])("pulling a closed pane $name", ({ px, expected }) => {
        expect(dragReopensPane(px)).toBe(expected);
    });
});

describe("readerPrefs — sanitize", () => {
    it.each([
        { name: "null", stored: null },
        { name: "undefined", stored: undefined },
        { name: "a number", stored: 42 },
        { name: "a string", stored: "nope" },
    ])("returns the defaults for $name", ({ stored }) => {
        expect(sanitizeReaderPrefs(stored)).toEqual(DEFAULT_READER_PREFS);
    });

    it("returns a copy the caller can change without touching the shared defaults", () => {
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
                showOutline: false,
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
            showOutline: false,
            showComments: false,
            navWidthPct: 120,
            commentWidthPct: 85,
        });
    });

    it.each([
        { name: "comment rail", field: "commentWidthPct" },
        { name: "nav", field: "navWidthPct" },
    ] as const)("caps a stored $name width so the pane can't balloon", ({ field }) => {
        expect(sanitizeReaderPrefs({ [field]: 500 })[field]).toBe(NAV_WIDTH_MAX_PCT);
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
            showOutline: "yes",
            showComments: 0,
            navWidthPct: "wide",
            commentWidthPct: "wide",
        });

        expect(out).toEqual({
            fontId: DEFAULT_FONT_ID,
            sizePct: DEFAULT_SIZE_PCT,
            lineSpacingPct: DEFAULT_LINE_SPACING_PCT,
            paragraphSpacingPct: DEFAULT_PARAGRAPH_SPACING_PCT,
            letterSpacingPct: DEFAULT_LETTER_SPACING_PCT,
            wordSpacingPct: DEFAULT_WORD_SPACING_PCT,
            showNav: true,
            showOutline: true,
            showComments: true,
            navWidthPct: DEFAULT_NAV_WIDTH_PCT,
            commentWidthPct: DEFAULT_COMMENT_WIDTH_PCT,
        });
    });

    it.each([
        { name: "a NaN size", stored: { sizePct: Number.NaN }, field: "sizePct" },
        { name: "an infinite size", stored: { sizePct: Infinity }, field: "sizePct" },
        {
            name: "a NaN line spacing",
            stored: { lineSpacingPct: Number.NaN },
            field: "lineSpacingPct",
        },
        {
            name: "an infinite word spacing",
            stored: { wordSpacingPct: Infinity },
            field: "wordSpacingPct",
        },
        { name: "a NaN nav width", stored: { navWidthPct: Number.NaN }, field: "navWidthPct" },
        {
            name: "an infinite comment-rail width",
            stored: { commentWidthPct: Infinity },
            field: "commentWidthPct",
        },
    ] as const)("replaces $name with the default", ({ stored, field }) => {
        expect(sanitizeReaderPrefs(stored)[field]).toBe(DEFAULT_READER_PREFS[field]);
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
            showOutline: false,
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
            showOutline: false,
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
            showOutline: true,
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
            showOutline: true,
            showComments: true,
            navWidthPct: 70,
            commentWidthPct: 70,
        });
        expect(readReaderPrefs("pr")).toEqual({
            fontId: "sitka",
            sizePct: 90,
            ...spacingPrefs(110),
            showNav: false,
            showOutline: false,
            showComments: false,
            navWidthPct: 130,
            commentWidthPct: 115,
        });
    });

    it("returns the defaults when nothing is stored", () => {
        expect(readReaderPrefs("pr")).toEqual(DEFAULT_READER_PREFS);
    });

    it("hydrates the legacy font + size schema with default spacing", () => {
        // The literal key an earlier release saved under, so upgrading keeps it.
        localStorage.setItem(
            "emr.reader.type",
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
            JSON.stringify({
                fontId: "palatino",
                sizePct: 115,
                spacingPct: 120,
            }),
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
        failStorage("getItem");

        expect(readReaderPrefs("pr")).toEqual(DEFAULT_READER_PREFS);
    });

    it("carries on without saving when storage cannot be written", () => {
        failStorage("setItem");

        expect(() => writeReaderPrefs("pr", DEFAULT_READER_PREFS)).not.toThrow();
    });
});

describe("readerPrefs — anchored-layout width budget", () => {
    it.each([
        // nav 340 + doc 440 + doc bar 12 + rail 340 (native scrollbar inside)
        {
            name: "sums both rails, the document and its scrollbar",
            nav: true,
            rail: true,
            expected: 1132,
        },
        {
            name: "drops the nav width when the nav is hidden",
            nav: false,
            rail: true,
            expected: 792,
        },
        { name: "drops the rail when comments are hidden", nav: true, rail: false, expected: 792 },
        {
            name: "needs only the document + its scrollbar with both panels hidden",
            nav: false,
            rail: false,
            expected: 452,
        },
    ])("$name", ({ nav, rail, expected }) => {
        expect(readerMinWidth(nav, rail)).toBe(expected);
    });

    it.each([
        {
            name: "a wider nav",
            nav: true,
            rail: true,
            navPct: 130,
            railPct: 100,
            expected: 442 + 440 + 12 + 340,
        },
        {
            name: "a wider comment rail",
            nav: true,
            rail: true,
            navPct: 100,
            railPct: 130,
            expected: 340 + 440 + 12 + 442,
        },
        {
            name: "both rails resized",
            nav: true,
            rail: true,
            navPct: 130,
            railPct: 70,
            expected: 442 + 440 + 12 + 238,
        },
        {
            name: "a narrower nav with comments hidden",
            nav: true,
            rail: false,
            navPct: 70,
            railPct: 100,
            expected: 238 + 440 + 12,
        },
        {
            name: "a hidden nav's width preference ignored",
            nav: false,
            rail: true,
            navPct: 130,
            railPct: 130,
            expected: 440 + 12 + 442,
        },
    ])("scales the budget for $name", ({ nav, rail, navPct, railPct, expected }) => {
        expect(readerMinWidth(nav, rail, navPct, railPct)).toBe(expected);
    });

    it.each([
        {
            name: "a roomy frame allows the design maximum",
            frame: 2000,
            other: 340,
            expected: NAV_WIDTH_MAX_PCT,
        },
        // (1231 − 440 − 12 − 340) / 340 = 129.1% → floor 129.
        { name: "a tight frame allows only what fits", frame: 1231, other: 340, expected: 129 },
        {
            name: "a cramped frame still allows the design minimum",
            frame: 900,
            other: 340,
            expected: NAV_WIDTH_MIN_PCT,
        },
        // (1231 − 440 − 12 − 442) / 340 = 99.1% → floor 99.
        { name: "a wider other rail leaves less room", frame: 1231, other: 442, expected: 99 },
    ])("caps a rail's drag: $name", ({ frame, other, expected }) => {
        expect(maxRailWidthPct(frame, other)).toBe(expected);
    });
});
