// Mention-link hydration.
//
// The `rehypeMentions` plugin emits work-item and PR mentions as
// `<a class="emr-mention" href="mention://…">`. The `mention://` URL survives
// the sanitizer (allowlisted) but the browser can't navigate to it, so this
// DOM hydrator rewrites those hrefs to real ADO web URLs using context only
// available at mount time (org URL, project name, optional default repo).
//
// Mentions whose context can't be resolved keep their `mention://` href so a
// later hydration can upgrade them. User mentions are intentionally left
// non-navigable — only work-item and PR mentions get web URLs.

import * as React from "react";

import { parseMentionUrl } from "./mentions";

/**
 * Context describing how to turn a mention id into an ADO web URL.
 *
 * `orgUrl` and `projectName` are required for any link to resolve. The
 * `defaultRepoName` is a heuristic — pull-request mentions ideally carry
 * the repo in their URL params (set by `buildMentionMarkdown`), but
 * historical mentions or mentions imported from elsewhere may not.
 */
export interface MentionLinkResolution {
  /** Org root, no trailing slash. e.g. `https://dev.azure.com/contoso`. */
  orgUrl: string;
  /** Project slug used in ADO URLs. */
  projectName: string;
  /** Fallback repo name for PR mentions missing a `repo` URL param. */
  defaultRepoName?: string;
}

/**
 * React context carrying mention-resolution info. Provided near the top
 * of each app (PrTabApp, in-context reader, standalone) and consumed by the
 * shared `useMentionLinkHydration` hook below.
 *
 * `null` means "no context available" — components fall back to a no-op
 * (mentions stay unnavigable rather than crashing the render).
 */
export const MentionLinkContext =
  React.createContext<MentionLinkResolution | null>(null);

/**
 * Walk `root` and upgrade every work-item / pull-request mention link to a
 * navigable ADO URL. Idempotent: anchors that already have an https href are
 * left alone, so it's safe to call on every render.
 */
export function hydrateMentionLinks(
  root: HTMLElement | null,
  ctx: MentionLinkResolution | null,
): void {
  if (!root || !ctx) return;

  const links = root.querySelectorAll<HTMLAnchorElement>(
    'a.emr-mention[data-mention-kind="workitem"], a.emr-mention[data-mention-kind="pullrequest"]',
  );
  links.forEach((a) => {
    const current = a.getAttribute("href") ?? "";
    if (current.startsWith("http://") || current.startsWith("https://")) return;

    const parsed = parseMentionUrl(current);
    if (!parsed) return;

    const url = buildMentionWebUrl(parsed, ctx);
    if (!url) return;
    a.setAttribute("href", url);
    // New context so the user keeps their place; rel matches sanitize-urls.
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  });
}

/**
 * Build the ADO web URL for a parsed mention, or `undefined` when context is
 * insufficient (e.g. a PR mention with no repo and no `defaultRepoName`).
 * Shapes match ADO's first-party links:
 *   * Work item: `<org>/<project>/_workitems/edit/<id>`
 *   * Pull request: `<org>/<project>/_git/<repo>/pullrequest/<id>`
 * `ctx.orgUrl` is validated as an http(s) URL to avoid producing a navigable
 * `javascript:` URL from a malformed caller.
 */
function buildMentionWebUrl(
  parsed: { kind: string; id: string; params: Record<string, string> },
  ctx: MentionLinkResolution,
): string | undefined {
  let base: URL;
  try {
    base = new URL(ctx.orgUrl);
  } catch {
    return undefined;
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") return undefined;

  const orgUrl = `${base.origin}${base.pathname.replace(/\/+$/, "")}`;
  const project = encodeURIComponent(ctx.projectName);
  const id = encodeURIComponent(parsed.id);

  switch (parsed.kind) {
    case "workitem":
      return `${orgUrl}/${project}/_workitems/edit/${id}`;
    case "pullrequest": {
      const repo = parsed.params["repo"] ?? ctx.defaultRepoName;
      if (!repo) return undefined;
      return `${orgUrl}/${project}/_git/${encodeURIComponent(
        repo,
      )}/pullrequest/${id}`;
    }
    /* v8 ignore next 2 -- parseMentionUrl only yields handled kinds; defensive */
    default:
      return undefined;
  }
}

/**
 * React hook that hydrates mention links inside the given ref's element
 * whenever the dependency list changes. Pulls context from the nearest
 * `MentionLinkContext` provider.
 *
 * Use `React.useLayoutEffect` so the hydrated href is visible before the
 * browser paints — otherwise a fast click immediately after render would
 * find the placeholder `mention://` URL.
 */
export function useMentionLinkHydration(
  ref: React.RefObject<HTMLElement | null>,
  deps: React.DependencyList,
): void {
  const ctx = React.useContext(MentionLinkContext);
  React.useLayoutEffect(() => {
    hydrateMentionLinks(ref.current, ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, ...deps]);
}
