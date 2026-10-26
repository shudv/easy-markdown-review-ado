// Guard: the dev-only fault injector (src/dev/faults.ts) must never ship.
//
// Production builds set `__EMR_DEV_FAULTS__` to `false`, so the guarded
// `installDevFaults()` call and the whole module are dropped. This script
// proves it on the actual output: it scans every emitted JS file under dist/
// for markers unique to the fault injector and FAILS the build if any remain.
// Runs as part of `npm run build` and before packaging the production VSIX
// (scripts/package-extension.mjs — the Marketplace publish path).
//
// Usage: node scripts/check-no-dev-faults.mjs [distDir]

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(process.argv[2] ?? join(here, "..", "dist"));

// Strings that exist only in src/dev/faults.ts.
const MARKERS = ["__emrFaults", "emr.devFaults", "[dev faults]", "dev-fault"];

function* jsFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* jsFiles(path);
    else if (name.endsWith(".js")) yield path;
  }
}

if (!existsSync(distDir)) {
  console.error(`check-no-dev-faults: ${distDir} not found — build first.`);
  process.exit(1);
}

const hits = [];
let scanned = 0;
for (const file of jsFiles(distDir)) {
  scanned += 1;
  const text = readFileSync(file, "utf8");
  for (const marker of MARKERS) {
    if (text.includes(marker))
      hits.push(`${relative(distDir, file)}: ${marker}`);
  }
}

if (hits.length > 0) {
  console.error(
    "check-no-dev-faults: dev-only fault injection leaked into the build:\n  " +
      hits.join("\n  "),
  );
  process.exit(1);
}
console.log(`check-no-dev-faults: OK (${scanned} JS files clean)`);
