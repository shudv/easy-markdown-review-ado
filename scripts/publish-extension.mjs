// Publish the ADO extension to the Marketplace (and optionally share with one
// or more ADO orgs) via tfx-cli, which wraps the Marketplace publishing REST
// API. No manual browser upload required.
//
// Usage:
//   node --env-file=.env scripts/publish-extension.mjs --mode dev|prod
//     [--share-with org1,org2] [--no-package]
//
// Env vars (loaded from .env):
//   AZDO_PUBLISHER_ID  — your Marketplace publisher id (required)
//   AZDO_PAT           — PAT with Marketplace: Acquire & Manage (required)
//   AZDO_SHARE_WITH    — comma-separated ADO org names to share with
//                        (optional; --share-with overrides)
//
// What this does:
//   1. Runs scripts/package-extension.mjs to produce a fresh .vsix with a
//      monotonic version (skip with --no-package to publish the most recent
//      .vsix already in build/).
//   2. Finds the newest .vsix in build/ that matches this mode's id+publisher.
//   3. Calls `tfx extension publish` to upload it to the Marketplace.
//   4. Calls `tfx extension share` for each requested org (private extension
//      access lists are managed separately from publishing).
//
// Existing org shares persist across publishes — you only need --share-with
// the first time, or when adding a new org. Re-running on the same org is a
// safe no-op (we warn but don't fail).

import { spawnSync } from "node:child_process";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

// ---------- args ----------

const args = process.argv.slice(2);
const modeIdx = args.indexOf("--mode");
const mode = modeIdx >= 0 ? args[modeIdx + 1] : "prod";
if (mode !== "dev" && mode !== "prod") {
  console.error(
    `✘ --mode must be 'dev' or 'prod' (got: ${mode ?? "<missing>"})`,
  );
  process.exit(1);
}
const skipPackage = args.includes("--no-package");

const shareIdx = args.indexOf("--share-with");
const shareCliArg = shareIdx >= 0 ? args[shareIdx + 1] : null;
const shareWith = (shareCliArg ?? process.env.AZDO_SHARE_WITH ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ---------- validate env ----------

const publisher = (process.env.AZDO_PUBLISHER_ID ?? "").trim();
if (!publisher) {
  console.error("✘ AZDO_PUBLISHER_ID is not set in .env.");
  console.error(
    "  Create a publisher at https://aka.ms/vsmarketplace-manage-publishers",
  );
  console.error("  then add `AZDO_PUBLISHER_ID=<your-id>` to .env.");
  process.exit(1);
}

const pat = (process.env.AZDO_PAT ?? "").trim();
if (!pat) {
  console.error("✘ AZDO_PAT is not set in .env.");
  console.error(
    "  Generate one at https://dev.azure.com/<org>/_usersSettings/tokens",
  );
  console.error("  Required scope: Marketplace (Acquire & Manage).");
  process.exit(1);
}

const isWin = process.platform === "win32";

// ---------- 1. package (unless --no-package) ----------

if (!skipPackage) {
  console.log(`▸ Packaging .vsix (mode=${mode})…`);
  const packageResult = spawnSync(
    process.execPath,
    ["--env-file=.env", "scripts/package-extension.mjs", "--mode", mode],
    { stdio: "inherit", cwd: REPO_ROOT },
  );
  if (packageResult.status !== 0) {
    console.error("✘ Packaging failed");
    process.exit(packageResult.status ?? 1);
  }
} else {
  console.log(
    "▸ Skipping packaging (--no-package); will publish the newest existing .vsix.",
  );
}

// ---------- 2. find the newest matching .vsix ----------

const buildDir = join(REPO_ROOT, "build");
const manifestPath = join(REPO_ROOT, "vss-extension.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
// Keep the dev id suffix in sync with package-extension.mjs (AZDO_DEV_ID_SUFFIX),
// otherwise the vsix finder looks for the wrong prefix and may grab a stale
// (possibly tombstoned) build.
const devIdSuffix = (process.env.AZDO_DEV_ID_SUFFIX ?? "dev").trim() || "dev";
const idForMode =
  mode === "dev" ? `${manifest.id}-${devIdSuffix}` : manifest.id;
const prefix = `${publisher}.${idForMode}-`;

const candidates = readdirSync(buildDir)
  .filter((f) => f.startsWith(prefix) && f.endsWith(".vsix"))
  .map((f) => {
    const full = join(buildDir, f);
    return { name: f, full, mtime: statSync(full).mtimeMs };
  })
  .sort((a, b) => b.mtime - a.mtime);

if (candidates.length === 0) {
  console.error(`✘ No .vsix matching ${prefix}*.vsix in ${buildDir}.`);
  process.exit(1);
}
const vsix = candidates[0];
console.log(`▸ Publishing ${vsix.name}`);

// ---------- 3. tfx extension publish ----------

// Build the tfx args. `--share-with` is repeatable and lets tfx do the
// publish+share dance in a single API roundtrip, so we don't need a separate
// `tfx extension share` call for first-time shares.
const tfxPublishArgs = [
  "tfx",
  "extension",
  "publish",
  "--vsix",
  vsix.full,
  "--token",
  pat,
  "--no-prompt",
  "--no-color",
];
for (const account of shareWith) {
  tfxPublishArgs.push("--share-with", account);
}

const publishResult = spawnSync(isWin ? "npx.cmd" : "npx", tfxPublishArgs, {
  stdio: "inherit",
  cwd: REPO_ROOT,
  shell: isWin,
});
if (publishResult.status !== 0) {
  console.error("");
  console.error("✘ tfx publish failed.");
  console.error("  Common causes:");
  console.error("    - PAT lacks the 'Marketplace (Acquire & Manage)' scope.");
  console.error(
    "    - Version did not strictly increase (re-run package to mint a new timestamp).",
  );
  console.error(
    "    - Publisher id in .env doesn't match the one on the Marketplace.",
  );
  process.exit(publishResult.status ?? 1);
}

console.log("");
console.log(
  `✓ Published ${publisher}.${idForMode} @ ${vsix.name.replace(prefix, "").replace(/\.vsix$/, "")}.`,
);
if (shareWith.length > 0) {
  console.log(`✓ Shared with: ${shareWith.join(", ")}`);
} else {
  console.log(
    "ℹ No --share-with / AZDO_SHARE_WITH; existing org shares are preserved.",
  );
}
console.log("");
console.log(
  "  Refresh the PR page; ADO usually picks up the new version within ~1 minute.",
);
