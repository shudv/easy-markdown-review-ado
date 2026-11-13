# Localization

The UI ships in English plus seven languages: German (`de`), Spanish (`es`),
French (`fr`), Japanese (`ja`), Korean (`ko`), Brazilian Portuguese (`pt-BR`)
and Simplified Chinese (`zh-CN`).

## Why these languages

This is Microsoft's tier-1 set: the most-used Azure DevOps UI languages, and
together the large majority of developers. Every language we ship is one
Azure DevOps itself offers, so the extension matches the surrounding page.
Azure DevOps' other UI languages (Czech, Italian, Polish, Russian, Turkish,
Traditional Chinese) fall back to English. Regional variants share a
translation: `de-AT` gets `de`, and `pt-PT` gets `pt-BR`. Traditional Chinese
gets English rather than Simplified Chinese.

## How the language is chosen

Azure DevOps doesn't translate extension UI. It only tells the extension the
user's language, through `SDK.getPageContext().globalization.culture`. On
Azure DevOps Services that culture is the **browser's language**
(`Accept-Language`); the profile's preferred-language setting doesn't change
it. On Azure DevOps Server it is the profile's **Locale → Preferred language**.
`e2e/locale.spec.ts` checks this against the real host. Both entry points
(`pr-tab.tsx`, `markdownReviewHub.tsx`) start loading the matching
translation as soon as `SDK.ready()` resolves, and wait for it just before the
first render. English is bundled, so English users never wait. Each other
language is a small lazy chunk (`dist/i18n-<locale>.js`) that downloads while
the rest of boot runs. If the chunk fails to load, the app stays in English
instead of failing to boot.

The language is picked in this order (see [`src/i18n/locales.ts`](../src/i18n/locales.ts)):

1. The `emr.locale` key in `localStorage`, for QA and support. For example,
   run `localStorage.setItem("emr.locale", "ja")` in the extension iframe's
   console, then reload.
2. The Azure DevOps culture. A culture we don't ship gives English, even when
   another of the browser's languages is one we ship.
3. `navigator.languages`, only if the host provides no culture.

Dates and numbers are formatted with the user's full culture when it belongs to
the UI language (`en-GB` users get day-first dates). Otherwise they use the UI
language, so a sentence never mixes languages. Telemetry records the applied
`locale` on every event.

The extension manifest (`vss-extension.json`) is not localized. Its only
visible strings are the product name "Markdown Review" and the hub name
"Documents". tfx-cli has an undocumented `--loc-root` mechanism for this, but
it can only be verified with a Marketplace publish, so it isn't worth the risk
for one word.

## Writing UI strings

All user-visible text goes through [`src/i18n`](../src/i18n/index.ts):

```ts
import { t, tRich, getFormatLocale, formatNumber } from "../i18n";

t("comments.row.resolveThread"); // plain message
t("navigation.status.commentOf", { index: 3, total: 9 }); // {placeholders}, type-checked
t("navigation.nav.openComments", { count: n }); // plural message
tRich("comments.draft.body", { file: <b>{name}</b> }); // placeholders filled with React nodes
date.toLocaleDateString(getFormatLocale(), { month: "short" });
```

- **Catalog.** English messages live in [`src/i18n/en/`](../src/i18n/en/), one
  file per area (`common`, `hub`, `document`, `comments`, `navigation`,
  `shell`). Every key is prefixed with its area. `t()` keys and params are
  type-checked against this catalog.
- **Plurals.** Write `{ one: "{count} comment", other: "{count} comments" }`;
  `Intl.PluralRules` picks the form. Never build plurals with
  `n === 1 ? "" : "s"`.
- **Whole sentences.** Use placeholders, or `tRich` when markup sits inside a
  sentence. Don't concatenate fragments or change the case of translated text.
  Word order and grammar differ between languages.
- **Never call `t()` at module top level.** The translation loads after
  modules are imported, so the string would stay in English. Keep maps of
  keys, not maps of strings.
- **What not to translate:** telemetry names, console and thrown-error
  messages, keyboard key names, product names, and anything persisted to Azure
  DevOps for other people (comment bodies, PR descriptions).
- `count` is digit-grouped automatically (`1,234`). Other numbers, such as PR
  ids and update numbers, print verbatim.

## Adding or changing a string

1. Add or edit the English message in `src/i18n/en/<area>.ts`.
2. Add the same key to every file in
   [`src/i18n/translations/`](../src/i18n/translations/). If you change an
   English message's meaning, update every translation too.
3. Run `npx vitest run test/i18n.catalog.test.ts`. It fails when a translation
   is missing a key, has an extra one, changes a message's shape (plain or
   plural) or placeholders, or uses a plural category its language doesn't
   have.

Translations follow each language's Microsoft style guide and Azure DevOps'
own terminology. For example, Azure DevOps calls a pull request "Pull Request"
in German, "プル要求" in Japanese, and "拉取请求" in Chinese. Translation files
are excluded from cspell.

## Adding a language

1. Add the tag to `SUPPORTED_LOCALES` in `src/i18n/locales.ts`, and map its
   regional variants in `resolveLocale` if needed.
2. Add a loader for it in `src/i18n/i18n.ts` and create
   `src/i18n/translations/<tag>.json`.
3. The catalog test then covers the new file automatically.

## Reviewing a language

- In Storybook, pick a language from the **Language** toolbar menu (globe
  icon). Every story re-renders in that language.
- In Azure DevOps Services, put the language first in the browser's language
  settings (or launch Chromium with `--lang=<tag>`), or use the `emr.locale`
  override above. On Azure DevOps Server, change the profile's **Locale →
  Preferred language**.
