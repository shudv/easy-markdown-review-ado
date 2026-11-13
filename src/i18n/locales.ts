// Which UI languages we ship, and how a host/browser language tag maps onto one.
//
// The set is Microsoft's "tier 1" language set — the most-used Azure DevOps UI
// languages — which covers the large majority of developers: English plus
// Simplified Chinese, Japanese, German, French, Spanish, Brazilian Portuguese
// and Korean. Every other language (including the rest of Azure DevOps' own UI
// languages: cs, it, pl, ru, tr, zh-TW) falls back to English.

export const SUPPORTED_LOCALES = ["en", "de", "es", "fr", "ja", "ko", "pt-BR", "zh-CN"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

const TRADITIONAL_CHINESE = new Set(["hant", "tw", "hk", "mo"]);

function hasText(value: string | null | undefined): value is string {
    return value !== undefined && value !== null && value !== "";
}

function canonicalTag(tag: string | null | undefined): string | undefined {
    if (!hasText(tag)) return undefined;

    try {
        return Intl.getCanonicalLocales(tag.replace(/_/g, "-"))[0];
    } catch {
        return undefined;
    }
}

/**
 * Map a BCP 47 tag (`de-AT`, `pt-PT`, `zh-Hans-CN`, `en_GB`…) onto a shipped
 * locale, or `undefined` when we don't ship that language. Regional variants
 * share their language's translation (`pt-*` → `pt-BR`). Traditional Chinese
 * deliberately gets English rather than Simplified Chinese.
 */
export function resolveLocale(tag: string | null | undefined): Locale | undefined {
    const canonical = canonicalTag(tag);
    if (canonical === undefined) return undefined;

    const [language, ...subtags] = canonical.toLowerCase().split("-");

    if (language === "zh") {
        return subtags.some((s) => TRADITIONAL_CHINESE.has(s)) ? undefined : "zh-CN";
    }

    if (language === "pt") return "pt-BR";

    return SUPPORTED_LOCALES.find((l) => l === language);
}

export interface LocaleSources {
    /** Explicit override (the `emr.locale` storage key) — wins when supported. */
    override?: string | null;
    /**
     * The culture Azure DevOps reports (`SDK.getPageContext().globalization.culture`):
     * the browser's language on Services, the profile language on Server.
     */
    hostCulture?: string | null;
    /** `navigator.languages`, consulted only when the host gave no culture. */
    browserLanguages?: readonly string[];
}

/**
 * Pick the UI locale. The culture Azure DevOps reports is authoritative when
 * present: if we don't ship its language the user sees English, rather than
 * a lower-priority language from the browser's list.
 */
export function pickLocale(sources: LocaleSources): Locale {
    const fromOverride = resolveLocale(sources.override);
    if (fromOverride) return fromOverride;

    if (hasText(sources.hostCulture)) return resolveLocale(sources.hostCulture) ?? DEFAULT_LOCALE;

    for (const tag of sources.browserLanguages ?? []) {
        const resolved = resolveLocale(tag);
        if (resolved) return resolved;
    }

    return DEFAULT_LOCALE;
}

/**
 * The tag to hand `Intl` formatters (dates, numbers). Uses the user's full
 * culture when it belongs to the UI language — so an `en-GB` user gets
 * day-first dates while reading `en` strings — otherwise the UI locale, so a
 * sentence never mixes English words with, say, Italian month names.
 */
export function formattingLocale(culture: string | null | undefined, uiLocale: Locale): string {
    const canonical = canonicalTag(culture);

    return canonical !== undefined && resolveLocale(canonical) === uiLocale ? canonical : uiLocale;
}
