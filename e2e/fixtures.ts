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

export const test = base.extend({
  // (`provide` is Playwright's fixture callback, conventionally named `use`.)
  context: async ({ context }, provide) => {
    await context.grantPermissions(["local-network-access"], {
      origin: new URL(E2E.orgUrl).origin,
    });
    await provide(context);
  },
});

export { expect };
