// Shared Playwright fixtures for the e2e specs. Import `test` / `expect` from
// here (not from "@playwright/test") so every spec gets the same browser setup.
//
// Local Network Access: the dev extension's iframes are served from
// https://localhost:3000 inside the public ADO site, which Chromium blocks
// (net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS) unless the embedding site
// holds the "local network access" permission. We grant it to the ADO org
// origin ONLY — the same scoped grant `npm run dev:ado` gives a developer's
// browser — instead of disabling the check for every site. That keeps the test
// browser as close as possible to a real, correctly configured one.

import { test as base, expect } from "@playwright/test";

import { E2E } from "./env";

/**
 * The extension follows the test account's Azure DevOps language, but the
 * specs assert English text. Every spec therefore pins the extension to
 * English through its `emr.locale` override (written into the extension
 * frames' localStorage before any script runs), so the suite passes whatever
 * language the account is set to. `locale.spec.ts` opts out with
 * `test.use({ pinnedLocale: null })` to exercise the real host language.
 */
export const test = base.extend<{ pinnedLocale: string | null }>({
    pinnedLocale: ["en", { option: true }],
    // (`provide` is Playwright's fixture callback, conventionally named `use`.)
    context: async ({ context, pinnedLocale }, provide) => {
        await context.grantPermissions(["local-network-access"], {
            origin: new URL(E2E.orgUrl).origin,
        });
        await context.addInitScript(
            ({ devOrigin, locale }) => {
                if (location.origin !== devOrigin) return;

                if (locale === null) localStorage.removeItem("emr.locale");
                else localStorage.setItem("emr.locale", locale);
            },
            { devOrigin: new URL(E2E.devOrigin).origin, locale: pinnedLocale },
        );
        await provide(context);
    },
});

export { expect };
