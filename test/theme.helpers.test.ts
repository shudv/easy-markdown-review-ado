// The pure theme logic is tested directly here: `theme.ts` drags in the
// webpack-only `?raw` CSS imports (via `markdownStyles`) that Vitest can't
// resolve, whereas `theme.helpers.ts` has no such dependency. The DOM/SDK glue
// that uses these helpers is exercised by `theme.test.ts`.

import { describe, expect, it } from "vitest";

import {
    ALL_THEMES,
    isDarkLuminance,
    isDarkTheme,
    isEmrTheme,
    isHighContrastPrimary,
    parseLuminance,
    pickTheme,
} from "../src/theme/theme.helpers";

describe("ALL_THEMES", () => {
    it("offers the four Azure DevOps palettes, each labelled and flagged light or dark", () => {
        expect(ALL_THEMES).toEqual([
            { id: "light", label: expect.any(String), isDark: false },
            { id: "dark", label: expect.any(String), isDark: true },
            { id: "hc-light", label: expect.any(String), isDark: false },
            { id: "hc-dark", label: expect.any(String), isDark: true },
        ]);
        expect(ALL_THEMES.map((theme) => theme.label)).not.toContain("");
    });
});

describe("isEmrTheme", () => {
    it.each(ALL_THEMES.map((theme) => theme.id))("accepts the supported theme %s", (id) => {
        expect(isEmrTheme(id)).toBe(true);
    });

    it.each([
        { name: "an unknown theme name", value: "solarized" },
        { name: "an empty string", value: "" },
        { name: "null", value: null },
        { name: "undefined", value: undefined },
        { name: "a number", value: 42 },
        { name: "a theme-shaped object", value: { id: "light" } },
    ])("rejects $name", ({ value }) => {
        expect(isEmrTheme(value)).toBe(false);
    });
});

describe("isDarkTheme", () => {
    it.each([
        ["light", false],
        ["dark", true],
        ["hc-light", false],
        ["hc-dark", true],
    ])("reports %s as dark: %s", (theme, expected) => {
        expect(isDarkTheme(theme)).toBe(expected);
    });

    it("treats an unknown theme id as light", () => {
        expect(isDarkTheme("brand-new")).toBe(false);
    });
});

describe("pickTheme", () => {
    it.each([
        { name: "a light host picks light", isDark: false, forced: false, expected: "light" },
        { name: "a dark host picks dark", isDark: true, forced: false, expected: "dark" },
        {
            name: "a light host in high contrast picks hc-light",
            isDark: false,
            forced: true,
            expected: "hc-light",
        },
        {
            name: "a dark host in high contrast picks hc-dark",
            isDark: true,
            forced: true,
            expected: "hc-dark",
        },
    ])("$name", ({ isDark, forced, expected }) => {
        expect(pickTheme(isDark, forced)).toBe(expected);
    });
});

describe("isHighContrastPrimary", () => {
    it.each([
        { name: "a black accent", primary: "0, 0, 0" },
        { name: "a white accent", primary: "255, 255, 255" },
        { name: "a grey accent", primary: "128, 128, 128" },
        { name: "a grey accent written without spaces", primary: "12,12,12" },
        { name: "a grey accent with padded commas", primary: " 12 , 12 , 12 " },
    ])("detects ADO's high-contrast picker from $name", ({ primary }) => {
        expect(isHighContrastPrimary(primary)).toBe(true);
    });

    it.each([
        { name: "the default blue accent", primary: "0, 120, 212" },
        { name: "a teal accent", primary: "0, 128, 128" },
        { name: "an almost-white coloured accent", primary: "255, 255, 254" },
        { name: "a coloured accent written without spaces", primary: "12,34,56" },
        { name: "no accent at all", primary: "" },
        { name: "a value that is not an rgb triplet", primary: "transparent" },
    ])("treats $name as a regular theme", ({ primary }) => {
        expect(isHighContrastPrimary(primary)).toBe(false);
    });
});

describe("isDarkLuminance", () => {
    it.each([
        { name: "a black background reads as dark", luma: 0, expected: true },
        { name: "a dark grey background reads as dark", luma: 0.2, expected: true },
        {
            name: "a background at exactly half luminance reads as light",
            luma: 0.5,
            expected: false,
        },
        { name: "a light grey background reads as light", luma: 0.8, expected: false },
        { name: "a white background reads as light", luma: 1, expected: false },
        { name: "an unreadable background reads as light", luma: null, expected: false },
    ])("$name", ({ luma, expected }) => {
        expect(isDarkLuminance(luma)).toBe(expected);
    });
});

describe("parseLuminance", () => {
    it.each([
        { name: "black as #rgb", color: "#000", expected: 0 },
        { name: "white as #rgb", color: "#fff", expected: 1 },
        {
            name: "#rgb, expanding each digit (#abc is #aabbcc)",
            color: "#abc",
            expected: (0.2126 * 0xaa + 0.7152 * 0xbb + 0.0722 * 0xcc) / 255,
        },
        { name: "black as #rrggbb", color: "#000000", expected: 0 },
        { name: "white as #rrggbb", color: "#ffffff", expected: 1 },
        { name: "pure red", color: "#ff0000", expected: 0.2126 },
        { name: "pure green", color: "#00ff00", expected: 0.7152 },
        { name: "pure blue", color: "#0000ff", expected: 0.0722 },
        { name: "#rrggbbaa, ignoring alpha", color: "#ffffff00", expected: 1 },
        { name: "rgb() with commas", color: "rgb(255, 255, 255)", expected: 1 },
        { name: "rgba() with commas", color: "rgba(0,0,255,0.5)", expected: 0.0722 },
        { name: "rgba() in space syntax", color: "rgba(255 0 0 / 1)", expected: 0.2126 },
        { name: "a colour with surrounding whitespace", color: "\t#ffffff\n", expected: 1 },
    ])("reads the luminance of $name", ({ color, expected }) => {
        expect(parseLuminance(color)).toBeCloseTo(expected, 4);
    });

    it.each([
        { name: "an empty value", color: "" },
        { name: "whitespace", color: "   " },
        { name: "a colour keyword", color: "oops" },
        { name: "hsl(), which is unsupported", color: "hsl(0,0%,50%)" },
        { name: "a truncated hex", color: "#zz" },
        { name: "a full hex with a non-hex digit", color: "#gg0000" },
        { name: "a 4-digit hex", color: "#abcd" },
        { name: "a 5-digit hex", color: "#12345" },
    ])("returns null for $name", ({ color }) => {
        expect(parseLuminance(color)).toBeNull();
    });
});
