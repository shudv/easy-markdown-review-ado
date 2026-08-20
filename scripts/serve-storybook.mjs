// Static file server for the built Storybook, used by the visual-regression
// Playwright config (playwright.visual.config.ts) as its `webServer`.
//
// The visual suite screenshots `iframe.html?id=<story>&viewMode=story` from the
// *built* Storybook (not the dev server) so the frame is deterministic and free
// of the dev toolbar / HMR. This tiny server has zero dependencies.
//
// Usage:
//   node scripts/serve-storybook.mjs            # serve ./storybook-static
//   node scripts/serve-storybook.mjs --build    # (re)build first, then serve
//
// If the build output is missing it is built automatically, so a cold
// `npm run test:visual` just works.

import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(ROOT, "storybook-static");
const PORT = Number(process.env.EMR_VISUAL_PORT ?? 6007);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

function buildStorybook() {
  console.log("[serve-storybook] building Storybook → storybook-static …");
  const res = spawnSync(
    "npm",
    ["run", "build-storybook", "--", "-o", "storybook-static", "--quiet"],
    { cwd: ROOT, stdio: "inherit", shell: true },
  );
  if (res.status !== 0) {
    console.error("[serve-storybook] Storybook build failed.");
    process.exit(res.status ?? 1);
  }
}

const shouldBuild =
  process.argv.includes("--build") ||
  process.env.EMR_VISUAL_REBUILD === "1" ||
  !existsSync(join(OUT_DIR, "index.html"));
if (shouldBuild) buildStorybook();

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";
    // Prevent path traversal: resolve within OUT_DIR only.
    const filePath = normalize(join(OUT_DIR, pathname));
    if (!filePath.startsWith(OUT_DIR)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404).end("Not found");
      return;
    }
    const type =
      MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(readFileSync(filePath));
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
});

server.listen(PORT, () => {
  console.log(
    `[serve-storybook] serving storybook-static on http://localhost:${PORT}`,
  );
});
