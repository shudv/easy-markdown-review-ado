// Props contract of the Documents hub shell (`DocumentsApp`), shared with the
// hooks that bind the host's repo-scoped loaders onto the active repo.

import type { CommentAuthor, CommentThread } from "../types";
import type { RoutedPrInfo, DocLinkNavigation } from "../shell/PrShell";
import type { DocPrRef } from "../shell/prShellHelpers";
import type { CommentApi } from "../comments/api";
import type { DeepLinkTarget } from "../shell/deepLink";
import type { DocRepo, FolderListing } from "../shell/types";
import type { FileSearchOutcome } from "../shell/almSearch";

export interface DocumentsAppProps {
  repos: DocRepo[];
  /** Initial repo id; defaults to the first repo. */
  initialRepoId?: string;
  /** Resolve a markdown source by (repoId, path). */
  loadFileSource: (repoId: string, path: string) => Promise<string>;
  /** Resolve an image referenced from a repository document. */
  resolveDocumentImage?: (
    repoId: string,
    documentPath: string,
    repositoryPath: string,
    atCommitId?: string,
  ) => Promise<string | undefined>;
  /** Async threads loader. Called on mount and on repo switch. */
  loadThreadsFor: (repoId: string) => Promise<CommentThread[]>;
  currentUser: CommentAuthor;
  /**
   * Optional per-repo comment persistence boundary. When undefined for a repo
   * the shell falls back to `LocalOnlyCommentApi` (session-local writes) and
   * surfaces a banner. Real ADO returns an `AdoCommentApi` for the routing PR.
   */
  commentApiFor?: (repoId: string) => CommentApi | undefined;
  /**
   * Lazy folder enumeration, called the first time a folder is expanded.
   * Real ADO: `listFolderMarkdown`. Omitted in standalone. Returns the
   * immediate `.md` files + subfolder paths, and the folder's wiki `.order`.
   */
  onExpandFolder?: (repoId: string, path: string) => Promise<FolderListing>;
  /**
   * Lists a repo folder for a document's `[[_TOSP_]]` (table of subpages)
   * macro — at `atCommitId` for a historical version, else the default
   * branch; a missing folder lists as empty. Omitted in standalone.
   */
  onListSubpageFolder?: (
    repoId: string,
    folderPath: string,
    atCommitId?: string,
  ) => Promise<FolderListing>;
  /**
   * Async cross-folder filename search for one repo. Real ADO: ALM Code
   * Search. Omitted in standalone (DocNav falls back to local filter).
   */
  onSearchFiles?: (
    repoId: string,
    query: string,
    signal?: AbortSignal,
  ) => Promise<FileSearchOutcome>;
  /**
   * Per-repo deferred-details loader resolving the PR-routing target, called
   * the first time a repo is selected. The host dedupes concurrent calls.
   * Omitted in standalone (repos arrive fully resolved).
   */
  onLoadRepoDetails?: (repoId: string) => Promise<void>;
  /**
   * User-initiated refresh re-running root listing + PR routing. While in
   * flight the host sets the repo's `detailsLoaded` to `false`. Omitted in
   * standalone (the refresh button hides without a handler).
   */
  onRefreshRepo?: (repoId: string) => Promise<void>;
  /**
   * Organization web URL (no trailing slash). With `projectName`, mention
   * links are upgraded to real ADO web URLs by `comments/mentionLinks.ts`.
   * Omitted in standalone (mentions stay inert pills).
   */
  orgUrl?: string;
  /** Project name (URL slug). Required together with `orgUrl`. */
  projectName?: string;
  /**
   * Per-document comment persistence (Documents hub per-document routing).
   * When provided, the hub routes each document's comments to the most recent
   * COMPLETED PR that changed it instead of a single repo-level routing PR.
   * Supplying this (together with {@link loadThreadsForPath}) switches the hub
   * into per-document mode; the routed-PR pill is resolved per file via
   * {@link routedPrForPath}.
   */
  commentApiForPath?: (repoId: string, path: string) => CommentApi | undefined;
  /**
   * Per-document thread loader (Documents hub per-document routing). Loads a
   * single document's threads (from its routing PR) on demand. Presence of
   * this prop is what enables per-document mode.
   */
  loadThreadsForPath?: (
    repoId: string,
    path: string,
  ) => Promise<CommentThread[]>;
  /**
   * Per-document routed-PR resolver (per-document mode). Returns the routing
   * PR summary for a document so the rail can show a "Comments (PR #N)" pill
   * linking to where the comments live. Undefined until routing resolves.
   */
  routedPrForPath?: (
    repoId: string,
    path: string,
  ) => RoutedPrInfo | null | undefined;
  /**
   * Comment-history stepper loaders (per-document mode). Supplied together, they
   * let the comment rail walk a document's review history PR-to-PR: list its
   * completed PRs, read a historical PR's threads, and read the document's
   * source at a specific commit. Omitted in standalone (stepper stays off).
   */
  loadDocHistory?: (repoId: string, path: string) => Promise<DocPrRef[]>;
  loadThreadsForPr?: (
    repoId: string,
    prId: number,
    path: string,
  ) => Promise<CommentThread[]>;
  loadFileSourceAt?: (
    repoId: string,
    path: string,
    commitId: string,
  ) => Promise<string>;
  /**
   * Initial document to open (deep-link routing, `?path=`). Applies only to
   * the first mount of the initial repo — switching repos clears it so it
   * can't override later in-hub navigation.
   */
  initialSelectedPath?: string;
  /**
   * Called when the active document changes, so the host can reflect the
   * selected file in the route. Receives the active repo id and file path.
   */
  onSelectPath?: (repoId: string, path: string) => void;
  /**
   * Called when the active repo changes (in-rail selector), so the host can
   * reflect the selected repo in the route (`?repo=`).
   */
  onSelectRepo?: (repoId: string) => void;
  /**
   * Deep-link seed (`?comment=`): the thread to auto-open on first mount of
   * the initial repo. Forwarded to PrShell alongside `initialSelectedPath`.
   */
  initialActiveThreadId?: string;
  /**
   * Deep-link seed (`?anchor=`): the heading to scroll to on first mount of
   * the initial repo. Forwarded to PrShell alongside `initialSelectedPath`.
   */
  initialAnchor?: string;
  /**
   * Deep-link seed (`?text=`): the text to flash on first mount of the
   * initial repo. Forwarded to PrShell alongside `initialSelectedPath`.
   */
  initialTextFragment?: string;
  /**
   * Builds a shareable deep link to a thread, heading, or text in the given
   * repo/document, used by "Link to comment" and the heading / selection link
   * buttons.
   * Undefined in standalone (no host URL) — the link affordances are hidden.
   */
  buildDeepLink?: (
    repoId: string,
    path: string,
    target: DeepLinkTarget,
  ) => string | undefined;
  /**
   * Called after the user copies a heading link, so the host can mirror the
   * slug into the route's `?anchor=` param. Receives the active repo id.
   */
  onHeadingLinkCopied?: (repoId: string, anchor: string) => void;
  /** Called after a link to selected text is copied (see PrShell). */
  onTextLinkCopied?: (
    repoId: string,
    text: string,
    anchor: string | undefined,
  ) => void;
  /**
   * Called when the active comment thread changes, so the host can mirror it
   * into the route's `?comment=` param (the inverse of `initialActiveThreadId`).
   * Receives the active repo id and the thread id (`null` when cleared).
   */
  onActiveThreadChange?: (repoId: string, threadId: string | null) => void;
  /**
   * Called when a relative Markdown link resolves to something the hub can't
   * open in place — a non-Markdown file that should open in ADO's native Files
   * view. Receives the active repo id and the resolved navigation target.
   */
  onDocNavigate?: (repoId: string, target: DocLinkNavigation) => void;
  /**
   * Ordered repo list shown in the picker dropdown. In the paginated hub this
   * is the current (filtered or full) view, which can differ from `repos` (the
   * accumulated union used for selection + content). Defaults to `repos`.
   */
  repoPickerView?: DocRepo[];
  /** Current server-side picker filter keyword (controlled). Default "". */
  repoFilter?: string;
  /** Whether more repo pages can be fetched for the current picker view. */
  reposHasMore?: boolean;
  /** Whether a repo page/filter fetch is currently in flight. */
  reposLoading?: boolean;
  /**
   * Fetch the next page of repos for the picker (infinite scroll). Presence of
   * this prop switches the picker into paginated mode (filter box + scroll
   * loading) and makes it render even for a single visible repo.
   */
  onLoadMoreRepos?: () => void;
  /** Re-query the repo list with a server-side name filter (debounced by the picker). */
  onFilterRepos?: (keyword: string) => void;
}
