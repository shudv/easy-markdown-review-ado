// Host access-token seam.
//
// Every place that inspects the host token for the ADO dead window reads it
// through `readHostToken()` (see adoSessionSdk.ts). In production nothing is
// ever registered here, so it always defers to the real SDK. The dev-only
// fault injector (src/dev/faults.ts) registers an override to hand out a
// synthetic dead-window token, which is how the e2e suite reproduces the
// dead window against a real Azure DevOps org on demand.

let override: (() => string | null) | null = null;

/** Register (or clear, with `null`) a token override. Dev builds only. */
export function setHostTokenOverride(fn: (() => string | null) | null): void {
  override = fn;
}

/** The overriding token, or `null` to use the real host token. */
export function hostTokenOverride(): string | null {
  return override ? override() : null;
}
