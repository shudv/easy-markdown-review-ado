// Resolution of relative Markdown links (the kind ADO's native Files / wiki
// renderers resolve) into a neutral, SDK-free descriptor the reader can route:
//
//   • `[x](./sibling.md)` / `[x](../api/rest.md)` / `[x](page.md)` — resolved
//     against the CURRENT document's folder.
//   • `[x](/docs/design.md)` — resolved against the repo root.
//   • `[x](design.md#goals)` — the `#goals` fragment is preserved so the reader
//     can scroll to the heading once the target renders.
//   • `[x](#section)` — a pure in-page anchor.
//   • `https://…`, `mailto:…`, `mention://…`, `//cdn/…` — external; left for the
//     browser / existing handlers.
//
// Markdown targets (`.md` / `.markdown`) route to our in-extension experiences;
// everything else falls back to the native ADO Files view (handled by callers).

/** Where a clicked link points, resolved against the current document. */
export type DocLinkTarget =
  | { kind: "external" }
  | { kind: "anchor"; hash: string }
  | {
      kind: "repo-file";
      /** Repo-relative path, always leading-slash normalized (`/docs/x.md`). */
      path: string;
      /** Fragment after `#`, or `""`. */
      hash: string;
      /** Whether the target is a Markdown document (`.md` / `.markdown`). */
      isMarkdown: boolean;
    };

// A URL that carries its own scheme (`https:`, `mailto:`, `mention:`, `tel:`…).
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // Malformed percent-encoding — use the raw value rather than throwing.
    return value;
  }
}

/**
 * The directory segments of a repo path, e.g. `/docs/api/design.md` →
 * `["docs", "api"]`. A bare filename (`README.md`) yields `[]` (repo root).
 */
function dirSegments(path: string): string[] {
  const segments = path.split("/").filter(Boolean);
  segments.pop(); // drop the filename, leaving its containing folder
  return segments;
}

/**
 * Resolve `rel` (a relative or root-relative path, no scheme/fragment/query)
 * against `currentPath`, collapsing `.`/`..` segments. Always returns a
 * leading-slash repo path.
 */
function resolveRepoPath(currentPath: string, rel: string): string {
  const out = rel.startsWith("/") ? [] : dirSegments(currentPath);
  for (const segment of rel.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return "/" + out.join("/");
}

/**
 * Classify a link's `href` relative to the document at `currentPath`. Pure and
 * SDK-free so it can be unit-tested and shared by every surface.
 */
export function resolveDocLink(
  currentPath: string,
  rawHref: string,
): DocLinkTarget {
  const href = rawHref.trim();
  // Empty, scheme-qualified, or protocol-relative → not an in-repo doc link.
  if (!href || SCHEME_RE.test(href) || href.startsWith("//")) {
    return { kind: "external" };
  }
  // Pure in-page fragment.
  if (href.startsWith("#")) return { kind: "anchor", hash: href.slice(1) };

  // Peel off the fragment, then any query string, leaving the path.
  let pathPart = href;
  let hash = "";
  const hashIdx = pathPart.indexOf("#");
  if (hashIdx >= 0) {
    hash = pathPart.slice(hashIdx + 1);
    pathPart = pathPart.slice(0, hashIdx);
  }
  const queryIdx = pathPart.indexOf("?");
  if (queryIdx >= 0) pathPart = pathPart.slice(0, queryIdx);

  // `?query`/`#frag`-only hrefs carry no path: treat a lone fragment as an
  // in-page anchor, otherwise there's nothing to navigate to.
  if (!pathPart) {
    return hash ? { kind: "anchor", hash } : { kind: "external" };
  }

  const path = resolveRepoPath(currentPath, decodeSafe(pathPart));
  return {
    kind: "repo-file",
    path,
    hash,
    isMarkdown: /\.(md|markdown)$/i.test(path),
  };
}

/**
 * Absolute Azure Repos Files URL for `path` in `repoName`, e.g.
 * `https://dev.azure.com/org/Proj/_git/Repo?path=/docs/x.md&version=GBmain`.
 * Used to hand non-Markdown links (and out-of-scope files) to ADO's native
 * viewer in a new tab. `orgUrl` is the absolute org root (no trailing slash
 * required); the `_git/` route needs the repo NAME, not its GUID.
 */
export function buildReposFileUrl(
  orgUrl: string,
  project: string,
  repoName: string,
  path: string,
  version?: string,
): string {
  const params = new URLSearchParams({ path });
  if (version) params.set("version", version);
  const base = orgUrl.replace(/\/+$/, "");
  return `${base}/${encodeURIComponent(project)}/_git/${encodeURIComponent(
    repoName,
  )}?${params.toString()}`;
}

/** Case-insensitive, leading-slash-insensitive repo path equality. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/^\/+/, "").toLowerCase();
  return norm(a) === norm(b);
}

/** What the reader should do with a resolved link. */
export type DocLinkAction =
  | { type: "external" }
  | { type: "scroll"; hash: string }
  | { type: "select"; path: string; hash: string }
  | { type: "open-file"; path: string }
  | { type: "open-hub"; path: string; hash: string };

/** Context the router needs to decide where a Markdown link should open. */
export interface DocLinkContext {
  /** True in the Documents hub, where every doc link resolves within the hub. */
  isHub: boolean;
  /** The repo path of the document currently open. */
  currentPath: string;
  /** Whether a repo path is one the reader can open in place (a PR's files). */
  isInReader: (path: string) => boolean;
}

/**
 * Decide how to route a resolved {@link DocLinkTarget}:
 *   • external → leave to the browser;
 *   • in-page anchor / a link back to the current doc → scroll;
 *   • non-Markdown → open ADO's native Files view;
 *   • Markdown already openable here (a PR file, or anywhere in the hub) →
 *     select it in place;
 *   • Markdown outside the PR → open the Documents hub.
 * Pure + SDK-free so the whole decision table is unit-tested directly.
 */
export function routeDocLink(
  target: DocLinkTarget,
  ctx: DocLinkContext,
): DocLinkAction {
  if (target.kind === "external") return { type: "external" };
  if (target.kind === "anchor") return { type: "scroll", hash: target.hash };
  if (!target.isMarkdown) return { type: "open-file", path: target.path };
  if (samePath(target.path, ctx.currentPath)) {
    return { type: "scroll", hash: target.hash };
  }
  if (ctx.isHub || ctx.isInReader(target.path)) {
    return { type: "select", path: target.path, hash: target.hash };
  }
  return { type: "open-hub", path: target.path, hash: target.hash };
}
