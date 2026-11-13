// Run the curated visual-regression suite INSIDE the pinned Playwright container
// — the same image CI uses — so local renders are byte-identical to CI and a
// single committed baseline set suffices (no per-platform split).
//
// Why not just `playwright test` on the host? Chromium rasterizes text with the
// host OS font stack (DirectWrite / FreeType / CoreText), so a host render never
// matches CI's Linux render. Pinning the container fixes the environment.
//
// The static Storybook is BUILT ON THE HOST first — its bundle is platform-
// independent, and only the in-container Chromium render must match CI — then
// mounted in, so the container never rebuilds it (which would need Linux-native
// node_modules). Playwright core is pure JS, so it reuses the mounted host
// node_modules; the browsers are baked into the image.
//
// Usage:
//   node scripts/visual-docker.mjs            # compare against committed baselines
//   node scripts/visual-docker.mjs --update   # (re)write the single baseline set

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// Keep this tag in lockstep with the @playwright/test dependency.
const IMAGE = "mcr.microsoft.com/playwright:v1.62.1-jammy";
const update = process.argv.includes("--update");
const cwd = process.cwd();

// Arguments are passed as a list, never through a shell, so a working
// directory with spaces or shell characters can't change the command.
function run(command, args) {
    console.log(`\n$ ${[command, ...args].join(" ")}\n`);
    execFileSync(command, args, { stdio: "inherit" });
}

// 1) Build the static Storybook on the host (native toolchain) — the same
//    `storybook build` as `npm run build-storybook`, started through Node so no
//    shell is involved. The container serves this mounted copy via the
//    config's webServer and never rebuilds.
const require = createRequire(import.meta.url);
const storybookPackage = require.resolve("storybook/package.json");
const storybookBin = require(storybookPackage).bin;

run(process.execPath, [
    join(dirname(storybookPackage), storybookBin),
    "build",
    "-o",
    "storybook-static",
    "--quiet",
]);

// 2) Screenshot / compare inside the container — the CI-identical environment.
run("docker", [
    "run",
    "--rm",
    "-e",
    "CI=1",
    "-e",
    "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright",
    "-v",
    `${cwd}:/work`,
    "-w",
    "/work",
    IMAGE,
    "npx",
    "playwright",
    "test",
    "--config",
    "playwright.visual.config.ts",
    ...(update ? ["--update-snapshots=all"] : []),
]);

console.log(
    update
        ? "\nBaselines regenerated in the pinned container. Review + commit the *-chromium.png files."
        : "\nVisual comparison ran in the pinned container.",
);
