// Guards the translation files against drift from the English source catalog:
// every locale must translate exactly the English keys, keep each message's
// shape (plain vs plural) and placeholders, and use only plural categories the
// language actually has.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { AREAS, en } from "../src/i18n/en";
import { SUPPORTED_LOCALES } from "../src/i18n/locales";
import type { MessageValue, PluralMessage } from "../src/i18n/types";

type Catalog = Record<string, MessageValue>;

const english: Catalog = en;
const TRANSLATED = SUPPORTED_LOCALES.filter((l) => l !== "en");

const translationsDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../src/i18n/translations",
);

function loadTranslation(locale: string): Catalog {
    return JSON.parse(readFileSync(resolve(translationsDir, `${locale}.json`), "utf8")) as Catalog;
}

function forms(value: MessageValue): string[] {
    return typeof value === "string" ? [value] : Object.values(value as PluralMessage);
}

function placeholders(value: MessageValue): string[] {
    const names = new Set<string>();

    for (const form of forms(value)) {
        for (const match of form.matchAll(/\{(\w+)\}/g)) names.add(match[1]!);
    }

    if (typeof value !== "string") names.add("count");

    return [...names].sort();
}

/** What must match between a message and its translation, e.g. `plural(count,name)`. */
function shape(value: MessageValue): string {
    return `${typeof value === "string" ? "plain" : "plural"}(${placeholders(value).join(",")})`;
}

/** Problems with a single message, independent of its English source. */
function problems(value: MessageValue, categories: ReadonlySet<string>): string[] {
    const found = forms(value)
        .filter((form) => form.trim() === "")
        .map(() => "empty form");

    if (typeof value === "string") return found;

    if (!value.other) found.push("missing `other` form");

    for (const category of Object.keys(value)) {
        if (!categories.has(category)) found.push(`unused plural category "${category}"`);
    }

    return found;
}

/**
 * Every way a translation deviates from the English catalog, one line per
 * offending key, so a single failing test still names exactly what to fix.
 */
function catalogProblems(translation: Catalog, categories: ReadonlySet<string>): string[] {
    const found = Object.keys(translation)
        .filter((key) => !(key in english))
        .map((key) => `${key}: not in the English catalog`);

    for (const [key, source] of Object.entries(english)) {
        if (!(key in translation)) {
            found.push(`${key}: missing`);
        } else {
            const target = translation[key]!;

            if (shape(target) !== shape(source)) {
                found.push(`${key}: expected ${shape(source)}, got ${shape(target)}`);
            }

            found.push(...problems(target, categories).map((p) => `${key}: ${p}`));
        }
    }

    return found;
}

const ENGLISH_CATEGORIES = new Set(new Intl.PluralRules("en").resolvedOptions().pluralCategories);

describe("English catalog", () => {
    it("prefixes every key with its area, so areas can't shadow each other", () => {
        const areas = Object.entries(AREAS);

        const misplaced = areas.flatMap(([area, messages]) =>
            Object.keys(messages).filter((key) => !key.startsWith(`${area}.`)),
        );

        const total = areas.reduce((sum, [, messages]) => sum + Object.keys(messages).length, 0);

        expect(misplaced).toEqual([]);
        expect(Object.keys(english)).toHaveLength(total);
    });

    it("has well-formed messages", () => {
        const bad = Object.entries(english).filter(
            ([, value]) => problems(value, ENGLISH_CATEGORIES).length > 0,
        );

        expect(bad).toEqual([]);
    });
});

describe("translations", () => {
    it.each(TRANSLATED)(
        "%s matches the English catalog: same keys, shapes, placeholders, valid plurals",
        (locale) => {
            const categories = new Set<string>(
                new Intl.PluralRules(locale).resolvedOptions().pluralCategories,
            );

            expect(catalogProblems(loadTranslation(locale), categories)).toEqual([]);
        },
    );
});
