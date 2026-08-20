// Static manifest ↔ code consistency checks.
//
// These guard the "wiring drift" class of bug that nothing else catches:
// `tsc` can't see across JSON strings and string literals, and unit tests
// exercise behaviour, not the contribution contract.
//
// What we assert:
//   1. Every contribution `uri` that points at a built bundle (`dist/*.html`)
//      is actually produced by a webpack HtmlWebpackPlugin entry — so a
//      contribution can never reference a bundle that isn't built.
//   2. The full-page Documents hub lives in our own top-level hub group via a
//      relative (`.documents-hub-group`) target, not the Azure Repos group.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  HUB_CONTRIBUTION_ID,
  HUB_GROUP_CONTRIBUTION_ID,
} from "../src/menu/contributionIds";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const require = createRequire(import.meta.url);

interface Contribution {
  id: string;
  type: string;
  targets?: string[];
  properties?: Record<string, unknown>;
}

const manifest = JSON.parse(
  readFileSync(resolve(root, "vss-extension.json"), "utf8"),
) as { contributions: Contribution[] };

const contributions = manifest.contributions;
const byId = (id: string): Contribution | undefined =>
  contributions.find((c) => c.id === id);

// Build the production webpack config and read the HtmlWebpackPlugin instances
// so we know which `dist/*.html` files actually get emitted.
type WebpackFactory = (
  env: unknown,
  argv: { mode: string },
) => {
  entry: Record<string, string>;
  plugins: Array<{
    constructor: { name: string };
    userOptions?: { filename?: string; chunks?: string[] };
    options?: { filename?: string; chunks?: string[] };
  }>;
};
const webpackConfig = (require("../webpack.config.cjs") as WebpackFactory)(
  {},
  { mode: "production" },
);

const entryNames = new Set(Object.keys(webpackConfig.entry));

/** Map of emitted html filename (e.g. "hub/documents-hub.html") → chunk name. */
const htmlOutputs = new Map<string, string>();
for (const plugin of webpackConfig.plugins) {
  if (plugin.constructor.name !== "HtmlWebpackPlugin") continue;
  const opts = plugin.userOptions ?? plugin.options ?? {};
  if (opts.filename && opts.chunks?.[0]) {
    htmlOutputs.set(opts.filename, opts.chunks[0]);
  }
}

describe("manifest ↔ webpack bundles", () => {
  const builtUriContribs = contributions.filter((c) => {
    const uri = c.properties?.uri;
    return typeof uri === "string" && uri.startsWith("dist/");
  });

  it("has at least one dist-backed contribution to check", () => {
    expect(builtUriContribs.length).toBeGreaterThan(0);
  });

  it.each(builtUriContribs.map((c) => [c.id, c.properties!.uri as string]))(
    "contribution %s → %s is produced by a webpack html entry",
    (_id, uri) => {
      const rel = uri.replace(/^dist\//, "");
      const chunk = htmlOutputs.get(rel);
      expect(
        chunk,
        `No HtmlWebpackPlugin emits ${rel} (referenced by a contribution uri)`,
      ).toBeDefined();
      expect(
        entryNames.has(chunk!),
        `${rel} is wired to chunk "${chunk}" which is not a webpack entry`,
      ).toBe(true);
    },
  );
});

describe("manifest ↔ registration ids", () => {
  it("the full-page hub lives in our own top-level hub group", () => {
    const hub = byId(HUB_CONTRIBUTION_ID);
    expect(hub, "hub contribution missing").toBeDefined();
    expect(hub!.type).toBe("ms.vss-web.hub");
    // It targets our own group via a relative reference (leading dot), which
    // resolves within the same extension and so survives the dev/prod id
    // rewrite. It must NOT sit under the Azure Repos code-hub group anymore.
    expect(hub!.targets).toContain(`.${HUB_GROUP_CONTRIBUTION_ID}`);
    expect(hub!.targets).not.toContain("ms.vss-code-web.code-hub-group");
    expect(hub!.properties?.uri).toBe("dist/hub/documents-hub.html");
  });

  it("the top-level hub group targets the project hub-groups collection", () => {
    const group = byId(HUB_GROUP_CONTRIBUTION_ID);
    expect(group, "hub group contribution missing").toBeDefined();
    expect(group!.type).toBe("ms.vss-web.hub-group");
    expect(group!.targets).toContain(
      "ms.vss-web.project-hub-groups-collection",
    );
    expect(typeof group!.properties?.name).toBe("string");
  });
});
