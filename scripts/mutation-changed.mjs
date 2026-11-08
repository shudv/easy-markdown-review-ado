// Mutation-test only the source files this branch changes.
//
// A full `stryker run` re-tests every mutant (hours). This runs Stryker on the
// src files that differ from the base branch, plus uncommitted and untracked
// ones, keeping stryker.config.json's exclusions and its incremental cache, so
// a typical change is checked in minutes and the break threshold applies to
// the files it touched.
//
// Usage: node scripts/mutation-changed.mjs [--base <ref>] [extra stryker args]
// The base defaults to origin/main.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const baseFlag = args.indexOf("--base");
const base = baseFlag === -1 ? "origin/main" : args[baseFlag + 1];
const strykerArgs =
    baseFlag === -1 ? args : args.filter((_, i) => i !== baseFlag && i !== baseFlag + 1);

const git = (...gitArgs) =>
    execFileSync("git", gitArgs, { encoding: "utf8" }).split("\n").filter(Boolean);

const changed = new Set([
    ...git("diff", "--name-only", "--diff-filter=d", `${base}...HEAD`),
    ...git("diff", "--name-only", "--diff-filter=d", "HEAD"),
    ...git("ls-files", "--others", "--exclude-standard"),
]);

// .tsx is never mutated (stryker.config.json), so it isn't listed either.
const sources = [...changed].filter((path) => /^src\/.+(?<!\.d)\.ts$/.test(path)).sort();

if (sources.length === 0) {
    console.log(`No source files changed against ${base}; nothing to mutate.`);
    process.exit(0);
}

// Stryker applies `!` patterns after the files listed, so the config's
// exclusions (fixtures, SDK glue, Storybook-only code) still hold.
const config = JSON.parse(readFileSync("stryker.config.json", "utf8"));
const exclusions = config.mutate.filter((pattern) => pattern.startsWith("!"));

console.log(
    `Mutating ${sources.length} changed source file(s) against ${base} (the config's other exclusions still apply):`,
);
for (const path of sources) console.log(`  ${path}`);

const require = createRequire(import.meta.url);
const strykerBin = join(
    dirname(require.resolve("@stryker-mutator/core/package.json")),
    "bin",
    "stryker.js",
);

const run = spawnSync(
    process.execPath,
    [
        strykerBin,
        "run",
        "--incremental",
        "--mutate",
        [...sources, ...exclusions].join(","),
        ...strykerArgs,
    ],
    { stdio: "inherit" },
);

process.exit(run.status ?? 1);
