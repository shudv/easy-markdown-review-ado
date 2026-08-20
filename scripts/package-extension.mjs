// Package the ADO extension into a .vsix using tfx-cli.
//
// Usage:
//   node --env-file=.env scripts/package-extension.mjs --mode dev|prod
//
// What this does:
//   1. Validates AZDO_PUBLISHER_ID is set.
//   2. Runs webpack (production for --mode prod, development for --mode dev).
//   3. Writes a temporary overrides JSON that injects the publisher id and
//      (in dev mode) a baseUri pointing at https://localhost:3000/ plus a
//      timestamped version suffix so repeated dev publishes don't collide.
//   4. Invokes `tfx extension create` with that overrides file.
//
// Output: build/<publisher>.easy-markdown-review-<version>.vsix

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
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

const publisher = (process.env.AZDO_PUBLISHER_ID ?? "").trim();
if (!publisher) {
  console.error("✘ AZDO_PUBLISHER_ID is not set in .env.");
  console.error(
    "  Create a publisher at https://aka.ms/vsmarketplace-manage-publishers",
  );
  console.error("  then add `AZDO_PUBLISHER_ID=<your-id>` to .env.");
  process.exit(1);
}

// ---------- read base manifest for version ----------

const manifestPath = join(REPO_ROOT, "vss-extension.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const baseVersion = manifest.version ?? "0.0.1";

// ---------- 1. webpack ----------

console.log(`▸ Building (mode=${mode})…`);
const webpackMode = mode === "dev" ? "development" : "production";
const isWin = process.platform === "win32";
const webpackResult = spawnSync(
  isWin ? "npx.cmd" : "npx",
  ["webpack", "--mode", webpackMode, "--config", "webpack.config.cjs"],
  { stdio: "inherit", cwd: REPO_ROOT, shell: isWin },
);
if (webpackResult.status !== 0) {
  console.error("✘ webpack failed");
  process.exit(webpackResult.status ?? 1);
}

// ---------- 2. overrides ----------

const buildDir = join(REPO_ROOT, "build");
mkdirSync(buildDir, { recursive: true });

const overrides = { publisher };
if (mode === "dev") {
  overrides.baseUri = "https://localhost:3000/";
  // Bump version per publish so successive uploads don't collide. The
  // Marketplace requires 1-4 dot-separated non-negative integers (each
  // < 2^31), no pre-release suffix, so we append a 4th numeric segment.
  // Unix-seconds fits in int32 (good through Jan 2038) and is strictly
  // monotonic for back-to-back packages.
  overrides.version = `${baseVersion}.${Math.floor(Date.now() / 1000)}`;
  overrides.public = false;
  // Append "(dev)" to display name to make the dev variant visually distinct.
  overrides.name = `${manifest.name} (dev)`;
  // Use a different id so dev and prod extensions can coexist in the same org.
  // The Marketplace permanently reserves an extension id once it has been
  // published — even after the extension is deleted, the id is tombstoned and
  // cannot be recreated (tfx fails with "The extension already exists"). If a
  // dev id ever gets burned that way, set AZDO_DEV_ID_SUFFIX in .env to a fresh
  // token (e.g. `devlocal`, `dev2`) to mint a new, unused id without a code edit.
  const devIdSuffix = (process.env.AZDO_DEV_ID_SUFFIX ?? "dev").trim() || "dev";
  overrides.id = `${manifest.id}-${devIdSuffix}`;
} else {
  // Prod uploads also need a strictly increasing version per publish.
  // Use the same monotonic 4th-segment-as-unix-seconds trick so a single
  // `npm run package:prod` is always upload-ready without a manual bump.
  overrides.version = `${baseVersion}.${Math.floor(Date.now() / 1000)}`;
}

const overridesPath = join(buildDir, `overrides.${mode}.json`);
writeFileSync(overridesPath, JSON.stringify(overrides, null, 2));
console.log(`▸ Wrote overrides: ${overridesPath}`);

// ---------- 2b. dev manifest (renamed contribution titles) ----------
//
// tfx's --overrides-file CONCATENATES array fields (it does not merge by id), so
// we cannot rename contribution titles via the overrides file without producing
// duplicate-contribution errors. Instead, in dev mode we generate a temporary
// manifest that is a clone of vss-extension.json with the *visible* titles
// suffixed " (dev)" — e.g. "Markdown Review (dev)", "Open in Markdown Review (dev)".
// This makes the dev variant unambiguously distinguishable from a co-installed
// prod extension, so the e2e suite (and a human) can target the dev-only titles
// without ever driving the prod contribution. tfx resolves `files`/`icons`/
// `content` paths relative to the *manifest's own directory*, so the clone must
// live at the repo root next to dist/ and static/. We delete it after packaging.
// Keep the suffix in sync with AZDO_E2E_TITLE_SUFFIX in e2e/env.ts.
let manifestGlob = "vss-extension.json";
let devManifestPath = null;
if (mode === "dev") {
  const devTitleSuffix = " (dev)";
  const devManifest = structuredClone(manifest);
  devManifest.contributions = (manifest.contributions ?? []).map(
    (contribution) => {
      const next = structuredClone(contribution);
      const props = next.properties ?? {};
      if (typeof props.name === "string") {
        props.name = `${props.name}${devTitleSuffix}`;
      }
      if (typeof props.text === "string") {
        props.text = `${props.text}${devTitleSuffix}`;
      }
      // Strip the `dist/` prefix from the content URI. In prod the bundle files
      // are addressable under `dist/` on the Marketplace CDN, so the manifest
      // uses `dist/<entry>.html`. In dev the webpack-dev-server serves those same
      // entries at the ROOT of https://localhost:3000/ (publicPath `/`, so e.g.
      // `/hub/documents-hub.html`, `/pr-tab/pr-tab.html`). Since the
      // dev `baseUri` points the host at localhost, the URI must be root-relative
      // (no `dist/`) or the host iframe 404s. Verified against the live host.
      if (typeof props.uri === "string") {
        props.uri = props.uri.replace(/^dist\//, "");
      }
      next.properties = props;
      return next;
    },
  );
  devManifestPath = join(REPO_ROOT, "vss-extension.dev.generated.json");
  writeFileSync(devManifestPath, JSON.stringify(devManifest, null, 2));
  manifestGlob = devManifestPath;
  console.log(`▸ Wrote dev manifest (suffixed titles): ${devManifestPath}`);
}

// ---------- 3. tfx package ----------

console.log("▸ Packaging .vsix via tfx…");
const tfxResult = spawnSync(
  isWin ? "npx.cmd" : "npx",
  [
    "tfx",
    "extension",
    "create",
    "--manifest-globs",
    manifestGlob,
    "--overrides-file",
    overridesPath,
    "--output-path",
    buildDir,
    "--no-color",
  ],
  { stdio: "inherit", cwd: REPO_ROOT, shell: isWin },
);
// Clean up the temporary generated dev manifest regardless of tfx's outcome.
if (devManifestPath) {
  rmSync(devManifestPath, { force: true });
}
if (tfxResult.status !== 0) {
  console.error("✘ tfx packaging failed");
  process.exit(tfxResult.status ?? 1);
}

console.log("");
console.log(`✓ Packaged (mode=${mode}). VSIX written to ./build/`);
if (mode === "dev") {
  console.log("");
  console.log("Next steps for dev install:");
  console.log(
    "  1. Run `npm run dev` in another terminal (HTTPS dev server on :3000).",
  );
  console.log(
    "  2. Visit https://localhost:3000 once and accept the self-signed cert.",
  );
  console.log("  3. Upload the .vsix to your Marketplace publisher at");
  console.log("       https://marketplace.visualstudio.com/manage");
  console.log(
    "     and share the extension with your ADO org (only your org).",
  );
  console.log("  4. Install it into your org from the same Manage page.");
  console.log(
    "  5. Open your test PR; the 'Markdown Review (dev)' tab will load from localhost.",
  );
  console.log(
    "  6. Code changes hot-reload via webpack-dev-server; no re-package needed.",
  );
}
