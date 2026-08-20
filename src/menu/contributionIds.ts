// Single source of truth for the contribution "wiring" that connects the
// `vss-extension.json` manifest to the runtime code.
//
// This module exists to kill a class of silent-failure bug: the manifest
// declares a contribution `id` / target, and the code must reference the same
// id (e.g. when navigating the host to the hub). When those two halves drift,
// the Azure DevOps host simply finds nothing — no console error, nothing for
// `tsc` or unit tests to catch.
//
// By importing these constants in BOTH the runtime code and the manifest
// consistency test (`test/manifest.contributions.test.ts`), drift becomes a
// failing test in the normal `npm test` inner loop instead of a bug you only
// discover after deploying to a real ADO collection.
//
// SDK-free on purpose: it must be importable from Node-based tests.

/**
 * Manifest `id` of the full-page hub contribution. It lives inside our own
 * top-level hub group (`HUB_GROUP_CONTRIBUTION_ID`), not the Azure Repos group,
 * so ADO never injects (or duplicates) a repo picker above it. The hub is
 * addressed by this contribution id regardless of which group it belongs to.
 */
export const HUB_CONTRIBUTION_ID = "documents-hub";

/**
 * Manifest `id` of our top-level hub group (parallel to Repos/Boards/Pipelines).
 * The hub above targets it via the relative reference `.documents-hub-group`
 * — a leading-dot reference resolves within the same extension, so it survives
 * the dev/prod extension-id rewrite in `package-extension.mjs`.
 */
export const HUB_GROUP_CONTRIBUTION_ID = "documents-hub-group";
