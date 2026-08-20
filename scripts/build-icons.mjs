// Rasterize SVG icon sources into PNGs that the Marketplace will accept.
//
// The ADO Marketplace package validator rejects `.svg` files in the
// uploaded `.vsix`, so the production icons (referenced from
// `vss-extension.json`) must be PNG. We keep the original SVGs under
// `assets/icons/` as the design source of truth, and this script
// rasterizes them into `static/` (which is the folder included in the
// extension package).
//
// Run it explicitly (`npm run icons:build`) after editing an SVG, or
// rely on the `package:*` scripts which chain it automatically.
//
// Uses `@resvg/resvg-js` (pure JS + WASM) so the build works the same on
// Windows, macOS and Linux CI agents without a native rasterizer toolchain.

import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

// Per-icon recipe: source SVG (under `assets/icons`), output PNG (under
// `static`), and the pixel size to rasterize at.
//
// ADO hub icons are displayed at 16–18px (depending on the chrome theme)
// in the side-rail. To stay crisp on HiDPI displays where the host
// effectively downsamples a 2x asset, we rasterize at 64x64 — 2x of the
// largest size the host ever paints (~32px in expanded states). This
// gives the browser enough source pixels to render a sharp glyph at all
// sizes the chrome may pick.
const ICONS = [
  {
    source: "assets/icons/documents-hub-light.svg",
    output: "static/documents-hub-light.png",
    size: 64,
  },
  {
    source: "assets/icons/documents-hub-dark.svg",
    output: "static/documents-hub-dark.png",
    size: 64,
  },
  {
    // Marketplace extension icon (`icons.default` in vss-extension.json). The
    // 256x256 source viewBox is rasterized 1:1; the gallery downsamples it for
    // list/detail views, so a crisp square keeps it sharp at every size.
    source: "assets/icons/logo.svg",
    output: "static/logo.png",
    size: 256,
  },
];

let failed = false;
for (const { source, output, size } of ICONS) {
  const srcPath = join(REPO_ROOT, source);
  const outPath = join(REPO_ROOT, output);
  let svg;
  try {
    svg = readFileSync(srcPath, "utf8");
  } catch (err) {
    console.error(`\u2718 Could not read ${source}: ${err.message}`);
    failed = true;
    continue;
  }
  try {
    const resvg = new Resvg(svg, {
      // Force a square render at `size` px regardless of the SVG's
      // declared width/height — the source uses a 16x16 viewBox.
      fitTo: { mode: "width", value: size },
      background: "rgba(0,0,0,0)",
    });
    const png = resvg.render().asPng();
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, png);
    console.log(`\u2713 ${source} \u2192 ${output} (${size}x${size})`);
  } catch (err) {
    console.error(`\u2718 Failed to rasterize ${source}: ${err.message}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
