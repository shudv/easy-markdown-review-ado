// Bundle-size *report* for the two production entry points.
//
// Reports the gzipped + raw size of what each endpoint downloads on boot (the
// entry JS/CSS plus every static chunk HtmlWebpackPlugin injects into that
// page), and separately the combined size of the on-demand `import()` chunks
// (currently only mermaid, loaded lazily the first time a doc contains a
// diagram). This is purely informational — there is no budget/threshold and it
// never fails a build. It runs as part of `npm run build` so every production
// build prints where the weight is.
//
// Zero runtime dependencies: sizing uses Node's built-in zlib so the report
// runs anywhere `npm ci` has run, with nothing extra to resolve from the feed.
//
// Usage:
//   node scripts/check-bundle-size.mjs            # human-readable table
//   node scripts/check-bundle-size.mjs --json     # machine-readable output

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const distDir = join(repoRoot, "dist");

// The HtmlWebpackPlugin-generated HTML for each endpoint is the source of
// truth for "what does this page actually load initially": we parse the
// <script src> and <link href> tags it injected rather than guessing chunk
// names, so code-splitting changes are tracked automatically.
const ENTRIES = [
  { name: "pr-tab", html: "pr-tab/pr-tab.html" },
  { name: "documents-hub", html: "hub/documents-hub.html" },
];

const isJson = process.argv.includes("--json");

function warn(msg) {
  // Report-only: never fail the build. Surface the problem and skip.
  console.warn(`\n! bundle-size report skipped: ${msg}`);
  process.exit(0);
}

if (!existsSync(distDir)) {
  warn("dist/ not found. Run `npm run build` first.");
}

/** Extract the JS/CSS asset paths an HTML file references. */
function assetsFromHtml(htmlRel) {
  const htmlPath = join(distDir, htmlRel);
  if (!existsSync(htmlPath)) {
    warn(`${htmlRel} not found in dist/. Did the production build run?`);
  }
  const html = readFileSync(htmlPath, "utf8");
  const htmlBaseDir = dirname(htmlPath);
  const refs = new Set();
  const patterns = [
    /<script[^>]+src="([^"]+)"/g,
    /<link[^>]+href="([^"]+\.css)"/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const ref = m[1];
      if (/^https?:\/\//i.test(ref)) continue; // external, not our bundle
      // HtmlWebpackPlugin emits paths relative to the HTML file.
      refs.add(resolve(htmlBaseDir, ref));
    }
  }
  return [...refs];
}

function sizeOf(absPath) {
  const buf = readFileSync(absPath);
  return { raw: buf.length, gz: gzipSync(buf).length };
}

/** Recursively list every file under a directory as absolute paths. */
function walk(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(abs));
    else out.push(abs);
  }
  return out;
}

const results = [];
const initialAssets = new Set();
for (const entry of ENTRIES) {
  const assets = assetsFromHtml(entry.html);
  let raw = 0;
  let gz = 0;
  for (const a of assets) {
    if (!existsSync(a)) warn(`Referenced asset missing: ${a}`);
    initialAssets.add(a);
    const s = sizeOf(a);
    raw += s.raw;
    gz += s.gz;
  }
  results.push({ name: entry.name, files: assets.length, raw, gz });
}

// Lazy chunks = every emitted .js that no entry HTML references (webpack's
// on-demand `import()` splits — currently only mermaid). Fetched only when the
// feature runs, so they are reported as one combined "lazy" total rather than
// charged to a page's initial load. .LICENSE.txt sidecars aren't executable
// payload; .map files aren't shipped.
let lazyRaw = 0;
let lazyGz = 0;
let lazyFiles = 0;
for (const abs of walk(distDir)) {
  if (!abs.endsWith(".js")) continue;
  if (abs.endsWith(".LICENSE.txt")) continue;
  if (initialAssets.has(abs)) continue;
  const s = sizeOf(abs);
  lazyRaw += s.raw;
  lazyGz += s.gz;
  lazyFiles += 1;
}
results.push({ name: "lazy", files: lazyFiles, raw: lazyRaw, gz: lazyGz });

const kb = (n) => (n / 1024).toFixed(1);

if (isJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const rows = results.map((r) => ({
    bundle: r.name === "lazy" ? "lazy (on-demand)" : r.name,
    files: r.files,
    raw: `${kb(r.raw)} KB`,
    gzip: `${kb(r.gz)} KB`,
  }));
  console.log(
    "\nProduction bundle sizes (gzipped) — entries are initial load, " +
      "lazy is the combined on-demand `import()` payload:\n",
  );
  console.table(rows);
}
