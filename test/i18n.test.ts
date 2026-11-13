import { afterEach, describe, expect, it, vi } from "vitest";

import {
    formatNumber,
    getFormatLocale,
    getLocale,
    initLocale,
    initLocaleFromHost,
    readLocaleOverride,
    t,
} from "../src/i18n/i18n";
import {
    SUPPORTED_LOCALES,
    formattingLocale,
    pickLocale,
    resolveLocale,
} from "../src/i18n/locales";

vi.mock("../src/i18n/translations/de.json", () => ({
    default: {
        "common.cancel": "Abbrechen",
        "hub.prTab.reconnecting.expiredSignIn": "Weiter {eta}.",
        // Only `other`: German's `one` category must fall back to it.
        "hub.prTab.eta.aboutMinutes": { other: "in etwa {count} Minuten" },
    },
}));

vi.mock("../src/i18n/translations/fr.json", () => {
    throw new Error("chunk failed to load");
});

afterEach(async () => {
    window.localStorage.removeItem("emr.locale");
    await initLocale({});
});

describe("resolveLocale", () => {
    it.each([
        ["de-AT", "de"],
        ["JA", "ja"],
        ["en_GB", "en"],
        ["pt-PT", "pt-BR"],
        ["pt", "pt-BR"],
        ["zh", "zh-CN"],
        ["zh-Hans-CN", "zh-CN"],
        ["zh-SG", "zh-CN"],
    ])("maps %s to the shipped %s translation", (tag, expected) => {
        expect(resolveLocale(tag)).toBe(expected);
    });

    it.each(["zh-TW", "zh-Hant", "zh-HK", "it-IT", "ru", "not a tag!!", "", null, undefined])(
        "has no translation for %s",
        (tag) => {
            expect(resolveLocale(tag)).toBeUndefined();
        },
    );
});

describe("pickLocale", () => {
    it("prefers a supported override over everything else", () => {
        expect(pickLocale({ override: "ko", hostCulture: "de-DE", browserLanguages: ["fr"] })).toBe(
            "ko",
        );
    });

    it("ignores an unsupported override", () => {
        expect(pickLocale({ override: "xx", hostCulture: "de-DE" })).toBe("de");
    });

    it("treats the Azure DevOps language as authoritative, even when we don't ship it", () => {
        expect(pickLocale({ hostCulture: "it-IT", browserLanguages: ["de-DE"] })).toBe("en");
    });

    it("falls back to the first supported browser language when the host gives none", () => {
        expect(pickLocale({ browserLanguages: ["it-IT", "es-MX", "de"] })).toBe("es");
    });

    it("defaults to English", () => {
        expect(pickLocale({ browserLanguages: ["it-IT"] })).toBe("en");
        expect(pickLocale({})).toBe("en");
    });
});

describe("formattingLocale", () => {
    it.each([
        ["en-GB", "en", "en-GB"],
        ["de-AT", "de", "de-AT"],
        ["it-IT", "en", "en"],
        [undefined, "ja", "ja"],
        ["not a tag!!", "fr", "fr"],
    ] as const)("formats %s culture with UI locale %s as %s", (culture, ui, expected) => {
        expect(formattingLocale(culture, ui)).toBe(expected);
    });
});

describe("t (English)", () => {
    it("returns a plain message", () => {
        expect(t("common.cancel")).toBe("Cancel");
    });

    it("fills placeholders, printing non-count numbers verbatim", () => {
        expect(t("hub.prTab.reconnecting.expiredSignIn", { eta: 12345 })).toContain(
            "by itself 12345.",
        );
    });

    it("picks the plural form by count and groups the count's digits", () => {
        expect(t("hub.prTab.eta.aboutMinutes", { count: 1 })).toBe("within about 1 minute");
        expect(t("hub.prTab.eta.aboutMinutes", { count: 1234 })).toBe("within about 1,234 minutes");
    });

    it("leaves a placeholder visible rather than crashing when a param is missing", () => {
        const untyped = t as (key: string, params?: object) => string;

        expect(untyped("hub.prTab.reconnecting.expiredSignIn")).toContain("by itself {eta}.");
        expect(untyped("hub.prTab.reconnecting.expiredSignIn", {})).toContain("{eta}");
    });
});

describe("initLocale", () => {
    it("loads and applies a translation", async () => {
        await expect(initLocale({ hostCulture: "de-DE" })).resolves.toBe("de");

        expect(getLocale()).toBe("de");
        expect(getFormatLocale()).toBe("de-DE");
        expect(document.documentElement.lang).toBe("de");
        expect(t("common.cancel")).toBe("Abbrechen");
        expect(t("hub.prTab.reconnecting.expiredSignIn", { eta: "gleich" })).toBe("Weiter gleich.");
        expect(t("hub.prTab.eta.aboutMinutes", { count: 1 })).toBe("in etwa 1 Minuten");
        expect(t("hub.prTab.eta.aboutMinutes", { count: 1234 })).toBe("in etwa 1.234 Minuten");
        expect(formatNumber(1234.5)).toBe("1.234,5");
    });

    it.each(SUPPORTED_LOCALES.filter((l) => l !== "fr"))(
        "ships a loadable %s translation",
        async (locale) => {
            await expect(initLocale({ override: locale })).resolves.toBe(locale);
        },
    );

    it("falls back to English for keys a translation lacks", async () => {
        await initLocale({ hostCulture: "de-DE" });

        expect(t("common.delete")).toBe("Delete");
    });

    it("formats with the browser's first language when the host gives no culture", async () => {
        await initLocale({ browserLanguages: ["de-CH"] });

        expect(getFormatLocale()).toBe("de-CH");
    });

    it("stays in English when a translation chunk fails to load", async () => {
        await initLocale({ hostCulture: "de-DE" });

        await expect(initLocale({ hostCulture: "fr-FR" })).resolves.toBe("en");

        expect(getLocale()).toBe("en");
        expect(getFormatLocale()).toBe("en");
        expect(document.documentElement.lang).toBe("en");
        expect(t("common.cancel")).toBe("Cancel");
    });
});

describe("readLocaleOverride", () => {
    it("reads the emr.locale key", () => {
        expect(readLocaleOverride(() => ({ getItem: (k) => `value-of-${k}` }))).toBe(
            "value-of-emr.locale",
        );
    });

    it("returns null when storage is blocked", () => {
        expect(
            readLocaleOverride(() => {
                throw new DOMException("blocked", "SecurityError");
            }),
        ).toBeNull();
    });
});

describe("initLocaleFromHost", () => {
    it("uses the host culture", async () => {
        await expect(initLocaleFromHost(() => "de-DE")).resolves.toBe("de");
    });

    it("honours the emr.locale override", async () => {
        window.localStorage.setItem("emr.locale", "de");

        await expect(initLocaleFromHost(() => "en-US")).resolves.toBe("de");
    });

    it("falls back to the browser's languages when the page context is unavailable", async () => {
        await expect(
            initLocaleFromHost(() => {
                throw new Error("no page context");
            }),
        ).resolves.toBe(pickLocale({ browserLanguages: navigator.languages }));
    });
});
