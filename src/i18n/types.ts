// Message catalog shapes shared by the English source catalog, the translation
// files, and the runtime.

/**
 * A message that varies by count. Keys are CLDR plural categories as returned
 * by `Intl.PluralRules#select`; `other` is required and is the fallback for any
 * category a translation omits (e.g. ja/ko/zh only need `other`).
 */
export interface PluralMessage {
    readonly zero?: string;
    readonly one?: string;
    readonly two?: string;
    readonly few?: string;
    readonly many?: string;
    readonly other: string;
}

/** A message template. Placeholders are written `{name}`. */
export type MessageValue = string | PluralMessage;

/** Placeholder names in a template string: `"{a} of {b}"` → `"a" | "b"`. */
type Placeholders<S extends string> = S extends `${string}{${infer P}}${infer Rest}`
    ? P | Placeholders<Rest>
    : never;

/**
 * Placeholder names a message needs. Plural messages always need `count`
 * (it selects the form) plus anything any of their forms mention.
 */
export type MessagePlaceholders<V> = V extends string
    ? Placeholders<V>
    : V extends PluralMessage
      ? "count" | Placeholders<Extract<V[keyof V], string>>
      : never;
