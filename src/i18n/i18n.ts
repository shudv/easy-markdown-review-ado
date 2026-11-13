// Runtime message lookup.
//
// The locale is chosen once per page load (Azure DevOps reloads extension
// iframes when the user changes language), so the active catalog is plain
// module state rather than React context: `t()` works identically in React
// components, DOM decorators and pure helpers. English ships in the main
// bundle; every other locale is a lazily loaded chunk that the entry point
// fetches in parallel with the SDK handshake and awaits before first render.
//
// Never call `t()` at module top level — the result would be frozen in
// English before the locale loads. Call it at render/use time.

import { en, type MessageKey, type Messages } from "./en";
import {
    DEFAULT_LOCALE,
    formattingLocale,
    pickLocale,
    type Locale,
    type LocaleSources,
} from "./locales";
import type { MessagePlaceholders, MessageValue, PluralMessage } from "./types";

export type { MessageKey } from "./en";
export type { Locale } from "./locales";

/** A translation file: any subset of keys (missing keys fall back to English). */
type Translations = Partial<Record<MessageKey, MessageValue>>;

type TranslatedLocale = Exclude<Locale, "en">;

const LOADERS: Record<TranslatedLocale, () => Promise<{ default: unknown }>> = {
    de: () => import(/* webpackChunkName: "i18n-de" */ "./translations/de.json"),
    es: () => import(/* webpackChunkName: "i18n-es" */ "./translations/es.json"),
    fr: () => import(/* webpackChunkName: "i18n-fr" */ "./translations/fr.json"),
    ja: () => import(/* webpackChunkName: "i18n-ja" */ "./translations/ja.json"),
    ko: () => import(/* webpackChunkName: "i18n-ko" */ "./translations/ko.json"),
    "pt-BR": () => import(/* webpackChunkName: "i18n-pt-BR" */ "./translations/pt-BR.json"),
    "zh-CN": () => import(/* webpackChunkName: "i18n-zh-CN" */ "./translations/zh-CN.json"),
};

interface ActiveLocale {
    locale: Locale;
    formatLocale: string;
    translations: Translations;
    plural: Intl.PluralRules;
    number: Intl.NumberFormat;
}

function activate(locale: Locale, formatLocale: string, translations: Translations): ActiveLocale {
    return {
        locale,
        formatLocale,
        translations,
        plural: new Intl.PluralRules(locale),
        number: new Intl.NumberFormat(formatLocale),
    };
}

let active = activate(DEFAULT_LOCALE, DEFAULT_LOCALE, {});

/** The UI language strings are shown in. */
export function getLocale(): Locale {
    return active.locale;
}

/** The BCP 47 tag to pass to `Intl` / `toLocale*String` for dates and numbers. */
export function getFormatLocale(): string {
    return active.formatLocale;
}

/** Format a number with the user's grouping/decimal conventions. */
export function formatNumber(value: number): string {
    return active.number.format(value);
}

type ParamValue<P, V> = P extends "count" ? number : V;

/** The parameter object a message needs, with `V` as the non-count value type. */
type MessageParams<K extends MessageKey, V = string | number> = {
    readonly [P in MessagePlaceholders<Messages[K]>]: ParamValue<P, V>;
};

/** `[]` for messages without placeholders, `[params]` otherwise. */
export type MessageArgs<K extends MessageKey, V = string | number> = [
    MessagePlaceholders<Messages[K]>,
] extends [never]
    ? []
    : [params: MessageParams<K, V>];

function isPlural(value: MessageValue): value is PluralMessage {
    return typeof value !== "string";
}

/**
 * The template for `key` in the active locale (falling back to English), with
 * the plural form chosen by `params.count` for count-dependent messages.
 */
export function selectTemplate(key: MessageKey, params?: object): string {
    const value: MessageValue = active.translations[key] ?? en[key];
    if (!isPlural(value)) return value;

    // The message types require `count` for every plural message.
    const { count } = params as { count: number };

    return value[active.plural.select(count)] ?? value.other;
}

const PLACEHOLDER = /\{(\w+)\}/;

/** Split a template into alternating literal text and placeholder names. */
export function splitTemplate(template: string): string[] {
    return template.split(PLACEHOLDER);
}

/**
 * Render a parameter value. `count` gets locale digit grouping (it's always a
 * quantity); other numbers — PR ids, update numbers — are printed verbatim so
 * "PR #12345" never becomes "PR #12,345".
 */
export function formatParam(name: string, value: unknown): string {
    return name === "count" && typeof value === "number" ? formatNumber(value) : String(value);
}

/** Look up a message in the active locale and fill in its `{placeholders}`. */
export function t<K extends MessageKey>(key: K, ...args: MessageArgs<K>): string {
    const params = args[0] as Record<string, unknown> | undefined;
    const parts = splitTemplate(selectTemplate(key, params));

    return parts
        .map((part, i) => {
            if (i % 2 === 0) return part;

            return params && part in params ? formatParam(part, params[part]) : `{${part}}`;
        })
        .join("");
}

const OVERRIDE_STORAGE_KEY = "emr.locale";

/** The `emr.locale` override (QA / support), if storage is readable. */
export function readLocaleOverride(getStorage: () => Pick<Storage, "getItem">): string | null {
    try {
        return getStorage().getItem(OVERRIDE_STORAGE_KEY);
    } catch {
        // Even touching `localStorage` throws in sandboxed / storage-blocked iframes.
        return null;
    }
}

/**
 * Choose and load the UI locale, then make it active. Resolves to the locale
 * actually applied: if a translation chunk fails to load the app stays in
 * English rather than failing to boot.
 */
export async function initLocale(sources: LocaleSources): Promise<Locale> {
    const locale = pickLocale(sources);
    const culture = sources.hostCulture ?? sources.browserLanguages?.[0];

    let translations: Translations = {};

    if (locale !== "en") {
        try {
            translations = (await LOADERS[locale]()).default as Translations;
        } catch {
            active = activate(DEFAULT_LOCALE, DEFAULT_LOCALE, {});
            document.documentElement.lang = DEFAULT_LOCALE;

            return DEFAULT_LOCALE;
        }
    }

    active = activate(locale, formattingLocale(culture, locale), translations);
    document.documentElement.lang = locale;

    return locale;
}

/**
 * Entry-point helper: load the locale for the user's Azure DevOps language
 * (`readHostCulture` should return `SDK.getPageContext().globalization.culture`),
 * honouring the `emr.locale` override and falling back to the browser's
 * languages if the host can't say.
 */
export function initLocaleFromHost(readHostCulture: () => string | undefined): Promise<Locale> {
    let hostCulture: string | undefined;

    try {
        hostCulture = readHostCulture();
    } catch {
        // Page context unavailable (older host) — use the browser's languages.
    }

    return initLocale({
        override: readLocaleOverride(() => window.localStorage),
        hostCulture,
        browserLanguages: navigator.languages,
    });
}
