import { describe, it, expect } from "vitest";

import { EMOJI_SHORTCODES, replaceEmojiShortcodes } from "../src/markdown/emoji";

describe("replaceEmojiShortcodes", () => {
    it("returns the string unchanged when it has no colon", () => {
        const input = "no shortcodes here";
        expect(replaceEmojiShortcodes(input)).toBe(input);
    });

    it("replaces a known shortcode", () => {
        expect(replaceEmojiShortcodes("hi :wave:")).toBe("hi 👋");
    });

    it("replaces multiple shortcodes in one string", () => {
        expect(replaceEmojiShortcodes(":fire: :rocket:")).toBe("🔥 🚀");
    });

    it("leaves names of built-in object properties as typed", () => {
        const input = ":constructor: :__proto__: :tostring: :hasownproperty:";
        expect(replaceEmojiShortcodes(input)).toBe(input);
    });

    it("leaves an unknown shortcode verbatim", () => {
        expect(replaceEmojiShortcodes("a :totally_unknown: b")).toBe("a :totally_unknown: b");
    });

    it("is case-insensitive on the shortcode name", () => {
        expect(replaceEmojiShortcodes(":TADA:")).toBe("🎉");
    });

    it("does not treat a lone colon or `::` as a shortcode", () => {
        expect(replaceEmojiShortcodes("ratio 3:4 and :: here")).toBe("ratio 3:4 and :: here");
    });

    it("recognises every shortcode in the table and maps it to a non-empty emoji", () => {
        const names = Object.keys(EMOJI_SHORTCODES);
        const emoji = Object.values(EMOJI_SHORTCODES);

        expect(emoji).not.toContain("");
        expect(replaceEmojiShortcodes(names.map((name) => `:${name}:`).join(" "))).toBe(
            emoji.join(" "),
        );
    });
});
