// Centralised configuration for the e2e suite. Everything is overridable via
// environment variables (set them in `.env`, which the Playwright config
// loads), with defaults pointing at the provisioned sandbox so a checkout can
// run the loop with zero extra config.

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

const ORG_URL = env("AZDO_ORG_URL", "https://dev.azure.com/your-org").replace(
  /\/$/,
  "",
);

// Default dev-extension id is derived from your Marketplace publisher and the
// dev-id suffix (see scripts/package-extension.mjs), so other devs only need to
// set AZDO_PUBLISHER_ID in .env rather than hard-code their own id here.
const PUBLISHER = env("AZDO_PUBLISHER_ID", "your-publisher");
const DEV_ID_SUFFIX = env("AZDO_DEV_ID_SUFFIX", "devlocal");

export const E2E = {
  /** Collection root, e.g. https://dev.azure.com/your-org */
  orgUrl: ORG_URL,
  /** Sandbox project that `npm run setup:sandbox` provisions. */
  project: env(
    "AZDO_E2E_PROJECT",
    env("AZDO_TEST_PROJECT", "markdown-review-sandbox-v2"),
  ),
  /** Primary repo the specs start from. */
  repoA: env("AZDO_E2E_REPO", "api-reference"),
  /** A real Markdown file in repoA the specs target. */
  mdPathA: env("AZDO_E2E_MD_PATH", "/api/rest/pull-requests.md"),
  /**
   * A *second* real Markdown file in repoA, distinct from `mdPathA`. The
   * path-persistence spec uses it to prove a `?path=` deep link overrides the
   * repo's remembered document.
   */
  mdPathA2: env("AZDO_E2E_MD_PATH_A2", "/api/rest/repositories.md"),
  /** A second repo, for per-repo path-persistence assertions. */
  repoB: env("AZDO_E2E_REPO_B", "team-handbook"),
  /** A real Markdown file in repoB the persistence spec targets. */
  mdPathB: env("AZDO_E2E_MD_PATH_B", "/handbook/engineering/code-review.md"),
  /**
   * Repo whose nested docs exercise every relative-link form (sibling, parent,
   * root-absolute, in-page anchor, and a non-Markdown asset). Provisioned from
   * `sandbox/repos/doc-links-showcase`; the relative-doc-link spec drives it.
   */
  docLinksRepo: env("AZDO_E2E_DOCLINKS_REPO", "doc-links-showcase"),
  /**
   * A doc in `docLinksRepo` that links to a sibling `.md` (opened in place) and
   * to a non-Markdown asset (opened in ADO's Files view in a new tab).
   */
  docLinksDoc: env("AZDO_E2E_DOCLINKS_DOC", "/docs/getting-started.md"),
  /**
   * Title of the (intentionally active) PR in `docLinksRepo` that edits two
   * cross-linked guides. Opened in the PR tab to prove a link to a doc OUTSIDE
   * the PR opens the Documents hub in a new tab (buildHubDocUrl + openNewWindow).
   */
  docLinksPrTitle: env(
    "AZDO_E2E_DOCLINKS_PR_TITLE",
    "Expand the installation and configuration guides",
  ),
  /** Active PR that adds both a Markdown file and a Git LFS-backed image. */
  docLinksLfsPrTitle: env(
    "AZDO_E2E_DOCLINKS_LFS_PR_TITLE",
    "Render an LFS image added in a pull request",
  ),
  /** Origin the dev extension bundles are served from (`npm run dev:verify`). */
  devOrigin: env("AZDO_E2E_DEV_ORIGIN", "https://localhost:3000"),
  /**
   * Suffix appended to the dev extension's *visible* contribution titles by
   * `scripts/package-extension.mjs` (e.g. "Documents (dev)"). The specs target
   * the suffixed titles so they always drive the dev (localhost) contribution
   * even when the prod extension is installed in the same org. Set to an empty
   * string to match un-suffixed titles (e.g. when only prod is installed).
   */
  titleSuffix: env("AZDO_E2E_TITLE_SUFFIX", " (dev)"),
  /**
   * Fully-qualified id (`publisher.extension`) of the installed *dev*
   * extension. Used to address its hub contribution directly by URL so the
   * specs never depend on the exact left-nav label. Defaults to
   * `<AZDO_PUBLISHER_ID>.emr-<AZDO_DEV_ID_SUFFIX>`; override
   * with `AZDO_E2E_EXTENSION_ID` for another install.
   */
  extensionId: env(
    "AZDO_E2E_EXTENSION_ID",
    `${PUBLISHER}.emr-${DEV_ID_SUFFIX}`,
  ),
  /** Contribution id of the Documents hub (vss-extension.json). */
  hubId: env("AZDO_E2E_HUB_ID", "documents-hub"),
  /** Contribution id of the PR tab (vss-extension.json). */
  prTabId: env("AZDO_E2E_PR_TAB_ID", "markdown-review-pr-tab"),
  /** Repo whose PR the PR-tab spec drives. */
  prRepo: env("AZDO_E2E_PR_REPO", "api-reference"),
  /**
   * Title of a sandbox PR that changes Markdown *and* carries a seeded comment
   * thread (the `document-threads` overlay). The spec finds this PR's row in the
   * PR-list UI to discover its id, so it never hard-codes a
   * provisioning-order-dependent id (and the org's session cookie can't
   * authorize the `_apis` REST endpoint).
   */
  prTitle: env("AZDO_E2E_PR_TITLE", "Document PR thread endpoints"),
  /** Repo whose PR the change-highlighting spec drives. */
  diffRepo: env("AZDO_E2E_DIFF_REPO", "diff-showcase"),
  /**
   * Title of the active sandbox PR whose single file exercises every diff edge case
   * (adds, edits, a removed section, multiple hunks) — the `complex-diff`
   * overlay in the `diff-showcase` repo. The change-highlighting spec finds
   * this PR's row to discover its id.
   */
  diffPrTitle: env(
    "AZDO_E2E_DIFF_PR_TITLE",
    "Showcase block-level diff confidence",
  ),
  /** Active PR carrying native ADO PNG, animated GIF, and file attachments. */
  commentMediaRepo: env(
    "AZDO_E2E_COMMENT_MEDIA_REPO",
    "production-markdown-showcase",
  ),
  /** Title of the native comment media sandbox PR. */
  commentMediaPrTitle: env(
    "AZDO_E2E_COMMENT_MEDIA_PR_TITLE",
    "Exercise production Markdown syntax and retire a legacy guide",
  ),
  /**
   * Picker search string that matches a real org identity who is NOT the e2e
   * sign-in account (so the mention can't be name-resolved from the comment's
   * own author). The on-load mention-resolution spec posts a comment mentioning
   * this user, reloads, and asserts the reader pill shows their name — resolved
   * from ADO's `thread.identities` seed, the path that works in MSA orgs where
   * the by-id identity endpoint returns null. Set this to a second account in
   * your sandbox organization.
   */
  mentionQuery: env("AZDO_E2E_MENTION_QUERY", "second-account"),
  /**
   * Account hint shown in the interactive `npm run e2e:auth` sign-in prompt so
   * each dev is reminded which identity to use. Purely cosmetic — set
   * `AZDO_E2E_ACCOUNT` in `.env` to your own account, or leave the generic hint.
   */
  account: env("AZDO_E2E_ACCOUNT", "your Azure DevOps account"),
} as const;

/** Host (`localhost:3000`) of the dev origin, for scoping our contribution iframes. */
export const DEV_ORIGIN_HOST = new URL(E2E.devOrigin).host;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build an exact-match (case-insensitive) RegExp for one of OUR contribution
 * titles, accounting for the dev "(dev)" suffix. When a suffix is configured we
 * *require* it, so the locator can never match a co-installed prod contribution.
 */
export function contribTitleRe(base: string): RegExp {
  const b = escapeRe(base);
  const suffix = E2E.titleSuffix;
  if (!suffix.trim()) return new RegExp(`^${b}$`, "i");
  // " (dev)" → require the suffix but tolerate flexible whitespace before it.
  return new RegExp(`^${b}\\s*${escapeRe(suffix.trim())}$`, "i");
}

/** Repos → Files URL for a given file path on the default branch. */
export function filesUrl(repo: string, path: string): string {
  const enc = encodeURIComponent(path);
  return `${E2E.orgUrl}/${E2E.project}/_git/${repo}?path=${enc}`;
}

/**
 * Direct URL to our Documents hub contribution. Addressing the hub by its
 * `{publisher.extension}.{hubId}` contribution id (rather than clicking the
 * left-nav entry) keeps the spec independent of ADO's nav chrome and the
 * "(dev)" title suffix.
 */
export function hubUrl(): string {
  return `${E2E.orgUrl}/${encodeURIComponent(E2E.project)}/_apps/hub/${
    E2E.extensionId
  }.${E2E.hubId}`;
}

/**
 * Direct URL to a pull request with OUR Markdown Review tab pre-selected. The
 * `?_a={publisher.extension}.{prTabId}` query selects the contribution tab, so
 * the spec lands straight on our iframe without clicking ADO's tab chrome.
 */
export function prTabUrl(repo: string, prId: number | string): string {
  return `${E2E.orgUrl}/${encodeURIComponent(E2E.project)}/_git/${repo}/pullrequest/${prId}?_a=${E2E.extensionId}.${E2E.prTabId}`;
}
