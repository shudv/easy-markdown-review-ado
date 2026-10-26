// SDK glue for the shared ADO session monitor (see adoSession.ts): wires the
// host token reader and the host-page reload. Kept separate so adoSession.ts
// stays SDK-free and unit-testable.

import * as SDK from "azure-devops-extension-sdk";
import {
  CommonServiceIds,
  type IHostNavigationService,
} from "azure-devops-extension-api";

import { adoSession } from "./adoSession";
import { hostTokenOverride } from "./hostToken";

/**
 * The host access token as seen by the dead-window checks. Always the real
 * `SDK.getAccessToken()` in production; dev builds' fault injector can
 * substitute a synthetic dead-window token (see hostToken.ts).
 */
export function readHostToken(): Promise<string> {
  const fake = hostTokenOverride();
  return fake !== null ? Promise.resolve(fake) : SDK.getAccessToken();
}

/** Call once after `SDK.ready()` in each entry point. */
export function configureAdoSession(): void {
  adoSession.configure({
    getToken: readHostToken,
    // Reload the HOST page (not our iframe): only that makes the host
    // re-initialise its token cache and mint a fresh token immediately.
    reloadHost: async () => {
      const nav = await SDK.getService<IHostNavigationService>(
        CommonServiceIds.HostNavigationService,
      );
      nav.reload();
    },
  });
}
