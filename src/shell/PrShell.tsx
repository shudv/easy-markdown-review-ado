import type { DocumentImageResolver } from "../markdown/documentImages";
import type { ReaderActivity } from "./components/readerActivity";
// PrShell — shared shell for both the real ADO PR tab and the standalone
// dev preview. Owns the selected file, view mode, thread store, active
// thread, and draft anchor. All data arrives via props so callers can swap
// fixtures for live ADO data without changing this component.

import * as React from "react";

import type {
  ChangeType,
  CommentAuthor,
  CommentThread,
  DiffRange,
  FileInfo,
  PrInfo,
  ReactionKind,
  TextQuoteAnchor,
} from "../types";
import { isResolvedLike } from "../types";
import type { FileSearchOutcome } from "./almSearch";
import {
  initialThreadState,
  makeNewThread,
  selectGeneralThreads,
  selectThreadsByFile,
  threadReducer,
} from "../comments/store";
import {
  LocalOnlyCommentApi,
  CommentApiProvider,
  type CommentApi,
} from "../comments/api";
import {
  IdentityStore,
  IdentityStoreContext,
  type IdentityResolver,
} from "../comments/identityStore";
import { useThreadSync } from "../comments/useThreadSync";
import { adoSession } from "./adoSession";
import { SessionNotice } from "./components/SessionNotice";
import { ComposerBusyContext } from "./components/composerBusy";
import { RegisterEditorContext } from "./components/editorRegistry";
import { refineDiffRanges } from "../markdown/diffRefine";
import { renderMarkdown } from "../markdown/render";
import { resolveDocLink, routeDocLink, samePath } from "../markdown/docLinks";

import {
  ArticleView,
  type AnchorLayout,
  type SelectionLinkTarget,
} from "./components/ArticleView";
import { useDeepLink } from "./deepLink";
import {
  ANCHOR_TARGET_CUE_MS,
  currentTextCue,
  findAnchorTarget,
  flashAnchorTarget,
  flashTextTarget,
  holdScrollOnTarget,
  revealAnchorTarget,
} from "./headingAnchors";
import { findTextFragment, parseTextFragment } from "./textFragment";
import { copyText } from "../comments/clipboard";
import { DiffMinimap } from "./components/DiffMinimap";
import { CommentRail } from "./components/CommentRail";
import { buildRailModel } from "./components/CommentRail.helpers";
import {
  countCommentFilters,
  threadMatchesQuery,
  threadVisibleForCommentView,
  type CommentFilterCounts,
  type CommentFilterMode,
} from "./components/commentFilter";
import { DocNav } from "./components/DocNav";
import { DraftGuardDialog } from "./components/DraftGuardDialog";
import {
  ReaderStatusBar,
  type ReaderIterationOption,
} from "./components/ReaderStatusBar";
import {
  readReaderPrefs,
  writeReaderPrefs,
  resolveReaderFont,
  readerSpacingValues,
  clampNavWidthPct,
  clampCommentWidthPct,
  readerMinWidth,
  maxRailWidthPct,
  widthScale,
  dragClosesPane,
  dragReopensPane,
  DEFAULT_NAV_WIDTH_PCT,
  DEFAULT_COMMENT_WIDTH_PCT,
  type ReaderPrefs,
} from "./readerPrefs";
import {
  events,
  track,
  trackUserFacingError,
  markAppReady,
} from "../telemetry";
import { anchorKindOf } from "./anchorKind";
import { relocateAnchor, withSourceLocation } from "../comments/anchor";
import {
  collectMentionIdentities,
  collectUserMentionIds,
} from "../comments/mentions";
import {
  errorMessage,
  absentAtUpdateMessage,
  isItemNotFoundError,
  friendlyWriteError,
  clearIfSet,
  clearIfEquals,
  buildHistoryStops,
  stepStopIndex,
  historyChevronTooltip,
  allReviewIterations,
  resolveReviewIterationRange,
  reviewRangeLabel,
  sourceDiffRanges,
  isCommentUiClickTarget,
  countWords,
  wordCountDelta,
  buildReaderActivities,
  bindRepositoryImageResolver,
  type DocPrRef,
  type HistoryStop,
  type ReviewIterationRange,
} from "./prShellHelpers";
import { useDraftPersistence } from "./useDraftPersistence";
import type { FolderLister } from "./wikiOrder";
import { useWikiSubpages } from "./useWikiSubpages";
import {
  NEW_DRAFT_THREAD_ID,
  addCommentDraftTarget,
  draftSnippet,
  type DraftScope,
  type DraftTarget,
} from "./draftStorage";

interface PrShellProps {
  pr: PrInfo;
  /** Async loader for the Markdown source of a given file path. */
  loadFileSource: (path: string) => Promise<string>;
  diffsByFile: Record<string, DiffRange[]>;
  /** Complete base-commit Markdown by file, used for trustworthy old-block reconstruction. */
  originalSourcesByFile?: Record<string, string>;
  /** Initial threads — both current and historical, mixed. */
  initialThreads: CommentThread[];
  currentUser: CommentAuthor;
  /**
   * Persistence boundary for thread mutations. Defaults to an in-memory
   * implementation; the real ADO PR tab passes an `AdoCommentApi` instance.
   */
  commentApi?: CommentApi;
  /** Read-only mode: suppresses selection bubbles, draft and reply composers, and shows a banner. */
  readOnly?: boolean;
  /** Message shown in the read-only banner. */
  readOnlyMessage?: string;
  /** PR these comments route through; renders a pill at the top of the comment column. */
  routedPr?: RoutedPrInfo | null;
  /**
   * Per-document routed-PR resolver (Documents hub per-document routing). When
   * provided, the rail PR pill reflects the *selected file's* routing PR
   * instead of the single `routedPr` prop — each document's comments route to
   * the most recent completed PR that changed it. Returns undefined until the
   * routing PR resolves, so the pill simply stays hidden until then.
   */
  routedPrForPath?: (path: string) => RoutedPrInfo | null | undefined;
  /** Folder paths known to exist but not yet enumerated; forwarded to DocNav. */
  unloadedFolders?: ReadonlyArray<string>;
  /** Lazy folder expansion; undefined when every file is already loaded. */
  onExpandFolder?: (
    path: string,
  ) => Promise<{ files: FileInfo[]; folders: string[] } | null>;
  /**
   * Azure DevOps wiki `.order` page names per folder (slash-free path, `""`
   * for the root), forwarded to DocNav so wiki repos list pages in order.
   */
  folderOrders?: Readonly<Record<string, readonly string[]>>;
  /**
   * Lists a repository folder, for a document's `[[_TOSP_]]` (table of
   * subpages) macro. Omitted where folders can't be listed; the macro then
   * says subpages aren't available.
   */
  listFolder?: FolderLister;
  /** Async filename search; omitted in standalone (DocNav falls back to local filter). */
  onSearchFiles?: (
    query: string,
    signal?: AbortSignal,
  ) => Promise<FileSearchOutcome>;
  /** Replaces the static "Documents" title in the doc-nav header. */
  docNavTitleSlot?: React.ReactNode;
  /**
   * Host-provided reload of the file list / repo contents. Wired into the
   * reading toolbar's unified refresh (which also re-syncs comments); omitted
   * when the surface has no remote file listing to refresh.
   */
  onRefreshFiles?: () => void | Promise<void>;
  /**
   * Contact address for the subtle "share feedback / report a bug" pill pinned
   * to the bottom-right of the reader. When omitted the pill is hidden.
   */
  feedbackEmail?: string;
  /**
   * Loader for a fresh snapshot of remote threads. When set, the shell polls it
   * on a visibility-aware cadence and merges each snapshot via MERGE_REMOTE_THREADS
   * (preserving optimistic writes). Undefined disables background sync.
   */
  fetchRemoteThreads?: (signal: AbortSignal) => Promise<CommentThread[]>;
  /** Visible-tab poll cadence in milliseconds. Default 30_000. */
  threadSyncIntervalMs?: number;
  /**
   * Single-file mode (used by the in-context "Open in Markdown Review" side
   * panel). Hides the DocNav file tree entirely and collapses the grid to two
   * columns (article + comment rail). The shell still selects `pr.files[0]`,
   * so callers pass a one-file `PrInfo`. All comment behaviour is unchanged.
   */
  hideDocNav?: boolean;
  /**
   * Per-document comment routing (Documents hub "transparent PR" mode). When
   * provided, the shell resolves the active `CommentApi` from the *selected
   * file* instead of using the single `commentApi` prop — each document's
   * comments are persisted to its own dedicated housing PR. Existing consumers
   * (PR tab, standalone) don't pass this and keep the single-api behaviour.
   */
  commentApiForPath?: (path: string) => CommentApi | undefined;
  /**
   * Per-document thread loader (Documents hub "transparent PR" mode). When
   * provided, the shell loads the selected file's threads on demand (and polls
   * the active file) instead of receiving a single `initialThreads` snapshot.
   */
  loadThreadsForPath?: (path: string) => Promise<CommentThread[]>;
  /**
   * Comment-history stepper (Documents hub). The three loaders below are
   * provided together; when all are present the comment rail grows ‹ ›
   * chevrons that walk the document's review history PR-to-PR. Each historical
   * "stop" shows the document as it was at that PR's merge commit plus that
   * PR's comments, read-only. The live head ("Current") stays writable.
   */
  /** Loads a document's review-history stops (completed PRs, most recent first). */
  loadDocHistory?: (path: string) => Promise<DocPrRef[]>;
  /** Loads a historical PR's threads for the file (read-only stop view). */
  loadThreadsForPr?: (prId: number, path: string) => Promise<CommentThread[]>;
  /** Loads the document's Markdown source at a specific commit (a history stop). */
  loadFileSourceAt?: (path: string, commitId: string) => Promise<string>;
  /** Native iterations of the current PR, newest first with Latest at index 0. */
  reviewIterationStops?: readonly HistoryStop[];
  /** Merge base used for Update 1 and the dedicated All updates comparison. */
  reviewIterationBaseCommit?: string;
  /**
   * Comparison of PR updates to open with (from a shared link's
   * `iteration`/`base`). Defaults to "All updates".
   */
  initialIterationRange?: ReviewIterationRange;
  /**
   * Called when the compared PR updates change, so the host can mirror them
   * into the route and shared links. `null` means "All updates".
   */
  onIterationRangeChange?: (range: ReviewIterationRange | null) => void;
  /**
   * Which Markdown files a comparison of PR updates touches, by change type
   * (keyed by repo path). Lets the file list mark the files the selected
   * updates changed and dim the rest.
   */
  loadRangeChanges?: (
    range: ReviewIterationRange,
  ) => Promise<Readonly<Record<string, ChangeType>>>;
  /**
   * Seeds the initially-selected document (deep-link routing, `?path=`). When
   * omitted the shell selects `pr.files[0]`. Read once at mount — a path that
   * isn't in `pr.files` still renders, since `loadFileSource` loads any path.
   */
  initialSelectedPath?: string;
  /**
   * Called whenever the user opens a different document from the nav, so the
   * host can reflect the active file in the route (`?path=`).
   */
  onSelectPath?: (path: string) => void;
  /**
   * Navigate to a document/file this reader can't open in place: a relative
   * Markdown link pointing outside the current PR (→ Documents hub) or a
   * non-Markdown file (→ ADO's native Files view). In-PR / in-hub Markdown
   * links and in-page anchors are handled in place. Omitted in embeds without
   * host navigation.
   */
  onDocNavigate?: (target: DocLinkNavigation) => void;
  /** Resolve a repository image for the active document/version. */
  resolveDocumentImage?: DocumentImageResolver;
  /**
   * Deep-link target (`?comment=`): a thread to activate + scroll into view
   * once it renders. Consumed once — the shell waits for the thread's anchor
   * to mount (the linked document's threads may still be loading), then
   * highlights it and centers it, after which the seed is dropped so later
   * navigation isn't hijacked.
   */
  initialActiveThreadId?: string;
  /**
   * Called whenever the active comment thread changes (selected, deep-linked,
   * or cleared), so the host can keep the route's `?comment=` param in sync —
   * the inverse of `initialActiveThreadId`. This makes deep-linking two-way:
   * selecting a comment produces the same shareable URL the "Link to comment"
   * action would. `null` means no thread is active (param should be removed).
   */
  onActiveThreadChange?: (threadId: string | null) => void;
  /**
   * Deep-link target (`?anchor=`): a heading slug to scroll to once the
   * initially selected document renders. Collapsed sections hiding it are
   * expanded and the heading is held in view while late content settles.
   * Ignored when `initialActiveThreadId` is also set (the comment wins).
   * ADO/GitHub-style slugs (`a-&-b`) are matched onto ours (`a-b`).
   */
  initialAnchor?: string;
  /**
   * Called after the user copies a heading link, with the heading's slug, so
   * the host can mirror it into the route's `?anchor=` param (the address bar
   * then holds the same shareable link, as in ADO's own Markdown preview).
   * The copy affordance itself needs a `DeepLinkContext` builder from the host.
   */
  onHeadingLinkCopied?: (anchor: string) => void;
  /**
   * Deep-link target (`?text=`): a serialized text fragment to scroll to and
   * flash once the initially selected document renders. When the text can't
   * be found (edited since the link was made), `initialAnchor` — the section
   * it was in — is used instead. A `?comment=` link wins over both.
   */
  initialTextFragment?: string;
  /**
   * Called after the user copies a link to selected text, so the host can
   * mirror it into the route's `?text=` (and fallback `?anchor=`) params.
   */
  onTextLinkCopied?: (text: string, anchor: string | undefined) => void;
  /**
   * Which review experience this shell renders, used to (a) namespace the
   * locally-persisted comment draft (one per experience) and (b) drop the
   * routed-PR pill in the PR tab, where it's implicit. Omitted disables draft
   * persistence (standalone/preview embeds).
   */
  draftScope?: DraftScope;
  /** Enables Documents Hub routing behavior and layout-specific chrome. */
  documentsMode?: boolean;
}

/** Compact summary of the PR a Documents-hub document routes its comments to. */
export interface RoutedPrInfo {
  prId: number;
  title: string;
  status: "active" | "completed";
  /** Optional pre-built URL the rail can link to. */
  url?: string;
}

/**
 * A relative-link navigation this reader hands to the host: opening a Markdown
 * document in the Documents hub, or a non-Markdown file in ADO's native Files
 * view. (In-place selections and anchor scrolls never reach the host.)
 */
export type DocLinkNavigation =
  | { kind: "hub-doc"; path: string; hash: string }
  | { kind: "repo-file"; path: string };

/** Stable empty history reference so the stops memo doesn't churn each render. */
const EMPTY_DOC_HISTORY: DocPrRef[] = [];

/** Stable empty thread list for the stepper's read-only historical fallback. */
const EMPTY_THREADS: CommentThread[] = [];

// The nav rail's base width in px (the 100% nav-width scale). Mirrors the 340px
// base in `.emr-body__nav`'s flex-basis (styles.scss); drag deltas are
// converted to a percentage against it.
const NAV_BASE_WIDTH = 340;

export function PrShell(props: PrShellProps): React.ReactElement {
  const { pr, loadFileSource, initialThreads, currentUser } = props;
  const readOnly = props.readOnly ?? false;
  const readOnlyMessage = props.readOnlyMessage;
  const routedPr = props.routedPr;
  // Stable CommentApi: callers supply one (real ADO) or we fall back to a
  // session-local stub so standalone dev still works.
  const commentApiRef = React.useRef<CommentApi | null>(null);
  if (commentApiRef.current === null) {
    commentApiRef.current = props.commentApi ?? new LocalOnlyCommentApi();
    /* v8 ignore start -- only when a caller swaps the CommentApi instance after mount */
  } else if (props.commentApi && props.commentApi !== commentApiRef.current) {
    commentApiRef.current = props.commentApi;
  }
  /* v8 ignore stop */
  // Per-document routing cache (Documents hub "transparent PR" mode). The
  // effective `commentApi` is resolved from `selectedPath` further below.
  const perPathApiCacheRef = React.useRef<Map<string, CommentApi>>(new Map());

  // Shared identity store: one GUID→name cache reused by every rendered comment
  // so `@<GUID>` user mentions resolve consistently (ADO-style). The resolver
  // reads the latest effective CommentApi via a ref so a per-document API swap
  // still resolves; the store is created once and provided to the subtree.
  const resolveIdentitiesRef = React.useRef<IdentityResolver | undefined>(
    undefined,
  );
  const identityStoreRef = React.useRef<IdentityStore | null>(null);
  if (identityStoreRef.current === null) {
    identityStoreRef.current = new IdentityStore(
      (ids) =>
        /* v8 ignore start -- resolver is always wired before IdentityStore first fetches */
        resolveIdentitiesRef.current
          ? resolveIdentitiesRef.current(ids)
          : Promise.resolve({}),
      /* v8 ignore stop */
    );
  }
  const identityStore = identityStoreRef.current;

  // Transient error surfaced when a remote write fails. Cleared on next success.
  const [persistError, setPersistError] = React.useState<string | null>(null);

  // ---- state ----
  const [selectedPath, setSelectedPath] = React.useState<string>(
    /* v8 ignore next -- files[0]?.path/"" fallbacks are defensive; tests supply initialSelectedPath or a non-empty file list */
    props.initialSelectedPath ?? pr.files[0]?.path ?? "",
  );

  // Effective CommentApi. In per-document mode it's resolved (and cached) from
  // the selected file so each document writes to its own housing PR; otherwise
  // it's the single stable instance from props / the local fallback.
  const commentApiForPath = props.commentApiForPath;
  const { commentApi, perDocNoWriteTarget } = React.useMemo<{
    commentApi: CommentApi;
    perDocNoWriteTarget: boolean;
  }>(() => {
    if (commentApiForPath) {
      const cache = perPathApiCacheRef.current;
      let api = cache.get(selectedPath);
      if (!api) {
        // A document whose housing PR isn't resolved yet — or has none —
        // resolves to `undefined`; don't cache the fallback.
        api = commentApiForPath(selectedPath);
        if (api) cache.set(selectedPath, api);
      }
      // No routed PR to persist to: still render via the session-local stub,
      // but flag the document as having no write target so the composer is
      // shown read-only instead of silently accepting comments that never
      // reach ADO.
      if (api) return { commentApi: api, perDocNoWriteTarget: false };
      return { commentApi: commentApiRef.current!, perDocNoWriteTarget: true };
    }
    return { commentApi: commentApiRef.current!, perDocNoWriteTarget: false };
  }, [commentApiForPath, selectedPath]);

  // In per-document mode a document with no routed PR has nowhere to persist
  // comments, so present it as read-only rather than misleading the user into
  // writing comments that would be dropped.
  const effectiveReadOnly = readOnly || perDocNoWriteTarget;
  const effectiveReadOnlyMessage =
    readOnly || !perDocNoWriteTarget
      ? readOnlyMessage
      : "Comments are read-only here — this document isn't part of a completed pull request yet.";

  // Effective routed-PR pill. Per-document mode resolves it from the selected
  // file (its own routing PR); otherwise the single `routedPr` prop is used.
  const routedPrForPath = props.routedPrForPath;
  const routedPrResolution = React.useMemo<RoutedPrInfo | null | undefined>(
    () => (routedPrForPath ? routedPrForPath(selectedPath) : routedPr),
    [routedPrForPath, selectedPath, routedPr],
  );
  const effectiveRoutedPr = routedPrResolution ?? undefined;

  // Keep the identity resolver pointed at the current effective CommentApi.
  /* v8 ignore start -- else-arm hit only when the effective CommentApi lacks resolveIdentities */
  resolveIdentitiesRef.current = commentApi.resolveIdentities
    ? (ids) => commentApi.resolveIdentities!(ids)
    : undefined;
  /* v8 ignore stop */

  // Latest selected path for the visibility-aware poller (so its fetch closure
  // stays stable while always targeting the current document).
  const selectedPathRef = React.useRef(selectedPath);
  React.useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);
  const [commentFilter, setCommentFilter] =
    React.useState<CommentFilterMode>("active");
  // Scope toggle paired with the filter: hide comments not on the current file
  // (General/Overview + comments on files no longer in the PR).
  const [onlyThisFile, setOnlyThisFile] = React.useState(false);
  // Reader preference: whether the PR change highlights are shown. Defaults to
  // visible; the global toggle in the DocNav header flips it so a reader can
  // drop to the clean, latest version of every document at any time.
  const [diffHidden, setDiffHidden] = React.useState(false);
  // Reader preferences, restored from + persisted to localStorage. Typography
  // (font + size) lives in a shared key so it follows the reader across every
  // surface; panel visibility + nav width are scoped to THIS surface (PR tab vs
  // Documents hub) so their different navigation needs don't bleed into each
  // other.
  const prefsScope: DraftScope = props.draftScope ?? "pr";
  const [readerPrefs, setReaderPrefs] = React.useState<ReaderPrefs>(() =>
    readReaderPrefs(prefsScope),
  );
  React.useEffect(() => {
    writeReaderPrefs(prefsScope, readerPrefs);
  }, [prefsScope, readerPrefs]);
  const toggleReaderNav = React.useCallback(
    () => setReaderPrefs((p) => ({ ...p, showNav: !p.showNav })),
    [],
  );
  const toggleReaderOutline = React.useCallback(
    () => setReaderPrefs((p) => ({ ...p, showOutline: !p.showOutline })),
    [],
  );
  const toggleReaderComments = React.useCallback(
    () => setReaderPrefs((p) => ({ ...p, showComments: !p.showComments })),
    [],
  );
  const setReaderFont = React.useCallback(
    (fontId: string) => setReaderPrefs((p) => ({ ...p, fontId })),
    [],
  );
  const setReaderSize = React.useCallback(
    (sizePct: number) => setReaderPrefs((p) => ({ ...p, sizePct })),
    [],
  );
  const setReaderSpacing = React.useCallback(
    (spacingPct: number) =>
      setReaderPrefs((p) => ({
        ...p,
        lineSpacingPct: spacingPct,
        paragraphSpacingPct: spacingPct,
        letterSpacingPct: spacingPct,
        wordSpacingPct: spacingPct,
      })),
    [],
  );
  const resetNavWidth = React.useCallback(
    () => setReaderPrefs((p) => ({ ...p, navWidthPct: DEFAULT_NAV_WIDTH_PCT })),
    [],
  );
  const resetCommentWidth = React.useCallback(
    () =>
      setReaderPrefs((p) => ({
        ...p,
        commentWidthPct: DEFAULT_COMMENT_WIDTH_PCT,
      })),
    [],
  );
  // The reader frame. The resize handlers read its LIVE width to cap a drag at
  // the edge of the usable space — so growing a rail can never squeeze the
  // document below its floor and tip the reader into the too-narrow state — and
  // the too-narrow observer (below) watches it.
  const bodyFrameRef = React.useRef<HTMLDivElement | null>(null);
  const commentsAvailableRef = React.useRef(true);
  // Nav + comment resize: dragging a rail's inner-border handle sets THAT rail's
  // width live (continuous, clamped). The handle captures the pointer on press,
  // so every move — and the resize cursor — stays bound to it as the pointer
  // travels across the sheet; no document listeners or unmount teardown are
  // needed (capture releases itself on pointer-up and on unmount). A ref carries
  // the drag origin from the press to the moves it captures. The two rails
  // resize INDEPENDENTLY (separate prefs); each drag is capped via
  // `maxRailWidthPct` so the OTHER rail (always budgeted, since it can be
  // revealed) plus the document floor still fit.
  const navDragRef = React.useRef<{
    startX: number;
    startPct: number;
  } | null>(null);
  const onNavResizeStart = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      navDragRef.current = {
        startX: e.clientX,
        startPct: readerPrefs.navWidthPct,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic (test) pointer has no active id to capture — ignore */
      }
    },
    [readerPrefs.navWidthPct],
  );
  const onNavResizeMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = navDragRef.current;
      if (!drag) return;
      const frame = bodyFrameRef.current;
      /* v8 ignore next -- the frame is mounted throughout any in-progress drag */
      if (!frame) return;
      const frameWidth = frame.clientWidth;
      // Nav's RIGHT-border handle: dragging right (larger clientX) widens it.
      const deltaPct = ((e.clientX - drag.startX) / NAV_BASE_WIDTH) * 100;
      const rawTarget = drag.startPct + deltaPct;
      // Dragged well past the resize floor → collapse the pane (the same state
      // the status-bar toggle sets); the width pref is kept for the reopen.
      if (dragClosesPane(rawTarget)) {
        navDragRef.current = null;
        // The handle only exists while the nav is shown, so this always closes.
        setReaderPrefs((p) => ({ ...p, showNav: false }));
        return;
      }
      setReaderPrefs((p) => {
        const commentPx = commentsAvailableRef.current
          ? Math.round((NAV_BASE_WIDTH * p.commentWidthPct) / 100)
          : 0;
        const cap = maxRailWidthPct(frameWidth, commentPx);
        return {
          ...p,
          navWidthPct: Math.min(clampNavWidthPct(rawTarget), cap),
        };
      });
    },
    [],
  );
  const onNavResizeEnd = React.useCallback(() => {
    navDragRef.current = null;
  }, []);
  const commentDragRef = React.useRef<{
    startX: number;
    startPct: number;
  } | null>(null);
  const onCommentResizeStart = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      commentDragRef.current = {
        startX: e.clientX,
        startPct: readerPrefs.commentWidthPct,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic (test) pointer has no active id to capture — ignore */
      }
    },
    [readerPrefs.commentWidthPct],
  );
  const onCommentResizeMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = commentDragRef.current;
      if (!drag) return;
      const frame = bodyFrameRef.current;
      /* v8 ignore next -- the frame is mounted throughout any in-progress drag */
      if (!frame) return;
      const frameWidth = frame.clientWidth;
      // Comment rail's LEFT-border handle: dragging LEFT (smaller clientX) widens
      // it, so the delta sign is mirrored from the nav handle.
      const deltaPct = ((drag.startX - e.clientX) / NAV_BASE_WIDTH) * 100;
      const rawTarget = drag.startPct + deltaPct;
      // Dragged well past the resize floor → collapse the pane (the same state
      // the status-bar toggle sets); the width pref is kept for the reopen.
      if (dragClosesPane(rawTarget)) {
        commentDragRef.current = null;
        // The handle only exists while comments show, so this always closes.
        setReaderPrefs((p) => ({ ...p, showComments: false }));
        return;
      }
      setReaderPrefs((p) => {
        const navPx = Math.round((NAV_BASE_WIDTH * p.navWidthPct) / 100);
        const cap = maxRailWidthPct(frameWidth, navPx);
        return {
          ...p,
          commentWidthPct: Math.min(clampCommentWidthPct(rawTarget), cap),
        };
      });
    },
    [],
  );
  const onCommentResizeEnd = React.useCallback(() => {
    commentDragRef.current = null;
  }, []);
  // Reopen a collapsed pane by dragging its edge grabber inward. The grabber is
  // only mounted while the pane is hidden; crossing the trigger flips show* back
  // on (restoring the last width) and the grabber unmounts mid-drag — fine, the
  // gesture is done. A ref holds the press origin (null = no drag in progress).
  const navReopenRef = React.useRef<number | null>(null);
  const onNavReopenStart = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      navReopenRef.current = e.clientX;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic (test) pointer has no active id to capture — ignore */
      }
    },
    [],
  );
  const onNavReopenMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const startX = navReopenRef.current;
      if (startX === null) return;
      // Nav grabber sits at the LEFT edge: drag RIGHT (inward) to reopen.
      if (dragReopensPane(e.clientX - startX)) {
        navReopenRef.current = null;
        // The grabber only exists while the nav is hidden, so this reopens it.
        setReaderPrefs((p) => ({ ...p, showNav: true }));
      }
    },
    [],
  );
  const onNavReopenEnd = React.useCallback(() => {
    navReopenRef.current = null;
  }, []);
  const commentReopenRef = React.useRef<number | null>(null);
  const onCommentReopenStart = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      commentReopenRef.current = e.clientX;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic (test) pointer has no active id to capture — ignore */
      }
    },
    [],
  );
  const onCommentReopenMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const startX = commentReopenRef.current;
      if (startX === null) return;
      // Comment grabber sits at the RIGHT edge: drag LEFT (inward) to reopen.
      if (dragReopensPane(startX - e.clientX)) {
        commentReopenRef.current = null;
        // The grabber only exists while comments are hidden, so this reopens.
        setReaderPrefs((p) => ({ ...p, showComments: true }));
      }
    },
    [],
  );
  const onCommentReopenEnd = React.useCallback(() => {
    commentReopenRef.current = null;
  }, []);
  // Reveal the comments pane if it's hidden — called when the reader starts (or
  // restores) a comment/reply draft, whose composer lives in the rail, so the
  // pane always shows the moment there is something to write.
  const revealComments = React.useCallback(
    () =>
      setReaderPrefs((p) =>
        p.showComments ? p : { ...p, showComments: true },
      ),
    [],
  );
  // Graceful degradation: when the reader frame is narrower than the VISIBLE
  // columns need (a very narrow window, or zoomed in), disable the reader and
  // show a calm notice instead of crushing the prose. Single-file panels keep
  // their legacy shrink-and-scroll behaviour, so they never trip this.
  const [tooNarrow, setTooNarrow] = React.useState(false);
  const [activeThreadId, setActiveThreadId] = React.useState<string | null>(
    null,
  );
  // The single open comment composer for this experience, or null. A
  // new-comment draft uses `threadId === NEW_DRAFT_THREAD_ID` (+ its selection
  // anchor); a reply draft carries the real thread id. Only one is ever open —
  // opening a second while this one has text prompts the discard dialog.
  const [activeDraft, setActiveDraft] = React.useState<DraftTarget | null>(
    null,
  );
  // Pending discard prompt: the composer the user asked to open plus the
  // existing draft's file + snippet to show in the dialog.
  const [draftGuard, setDraftGuard] = React.useState<{
    requested: DraftTarget;
    existingPath: string;
    snippet: string;
  } | null>(null);
  const [draftY, setDraftY] = React.useState<number | null>(null);

  // The routed-PR pill is redundant in the PR tab (comments obviously belong to
  // the current PR), so suppress it there.
  const hidePrPill = props.draftScope === "pr";

  // The Documents Hub reviews a SINGLE file at a time against the latest master
  // (it merely borrows a completed PR — possibly one of several — to host the
  // threads). So the cross-file trays don't belong there: General/Overview
  // notes aren't about this document, and "files no longer in this PR" is
  // meaningless when there's no change-set (and the hub's file list is a lazily
  // loaded partial tree, so an ∉-files test would false-positive on
  // not-yet-expanded folders). In the hub we therefore render ONLY the threads
  // anchored to the open file.
  const isHub = props.draftScope === "hub";

  // Locally-persisted draft (one per experience). `onRestore` adopts a stored
  // draft on mount so its lock is live and its composer re-opens on the right
  // file; ArticleView recomputes a new-comment draft's Y as it wraps the anchor.
  const restoreDraft = React.useCallback(
    (target: DraftTarget) => {
      setActiveDraft(target);
      revealComments();
      setActiveThreadId(
        target.threadId === NEW_DRAFT_THREAD_ID ? null : target.threadId,
      );
    },
    [revealComments],
  );
  const draft = useDraftPersistence({
    scope: props.draftScope,
    activeDraft,
    onRestore: restoreDraft,
  });

  // The new-comment draft's anchor, shown only when its draft targets the file
  // currently on screen (a reply draft, or a draft on another file, shows none).
  const draftAnchor =
    activeDraft &&
    activeDraft.threadId === NEW_DRAFT_THREAD_ID &&
    activeDraft.path === selectedPath
      ? activeDraft.anchor
      : null;
  // The open reply composer's thread, shown only on its own file.
  const activeReplyThreadId =
    activeDraft &&
    activeDraft.threadId !== NEW_DRAFT_THREAD_ID &&
    activeDraft.path === selectedPath
      ? activeDraft.threadId
      : null;

  // Guarded open: adopt the requested composer unless a *different* draft still
  // holds text, in which case prompt to discard it first. An empty existing
  // draft is silently replaced (nothing to lose).
  const activeDraftRef = React.useRef(activeDraft);
  activeDraftRef.current = activeDraft;
  const requestDraft = React.useCallback(
    (target: DraftTarget) => {
      const current = activeDraftRef.current;
      const isSame =
        current !== null &&
        current.path === target.path &&
        current.threadId === target.threadId &&
        (target.threadId !== NEW_DRAFT_THREAD_ID ||
          JSON.stringify(current.anchor) === JSON.stringify(target.anchor));
      if (current === null || isSame || draft.getSnapshot().trim() === "") {
        if (!isSame) draft.clear();
        setActiveDraft(target);
        revealComments();
        if (target.threadId !== NEW_DRAFT_THREAD_ID) {
          setActiveThreadId(target.threadId);
        }
        return;
      }
      setDraftGuard({
        requested: target,
        existingPath: current.path,
        snippet: draftSnippet(draft.getSnapshot()),
      });
    },
    [draft, revealComments],
  );
  // Stable ref for the document-level ESC / outside-click handlers so they can
  // dismiss an *empty* draft without re-subscribing on every draft change.
  // Assigned on every render below (before any handler can fire), so the
  // `null!` seed is never actually called.
  const dismissEmptyDraftRef = React.useRef<() => void>(null!);
  dismissEmptyDraftRef.current = () => {
    // Never discard text the user has typed — only tear down a bare composer
    // (a selection with no reply/comment written yet).
    if (activeDraftRef.current === null) return;
    if (draft.getSnapshot().trim() !== "") return;
    draft.clear();
    setActiveDraft(null);
    setDraftY(null);
  };

  // ---- comment-history stepper ----
  // Only active when the host supplies all three loaders (Documents hub).
  const loadDocHistory = props.loadDocHistory;
  const loadThreadsForPr = props.loadThreadsForPr;
  const loadFileSourceAt = props.loadFileSourceAt;
  const completedPrHistoryEnabled = !!(
    loadDocHistory &&
    loadThreadsForPr &&
    loadFileSourceAt
  );
  const nativeIterationMode = !!(
    props.reviewIterationStops?.length &&
    props.reviewIterationBaseCommit &&
    loadFileSourceAt
  );
  // Per-path review-history stops, the active stop index, and the historical
  // content/threads caches (keyed by `path\u0000commit` and PR id respectively).
  const [historyByPath, setHistoryByPath] = React.useState<
    Record<string, DocPrRef[]>
  >({});
  const [completedHistoryStopIndex, setCompletedHistoryStopIndex] =
    React.useState(0);
  const nativeUpdateCount = Math.max(
    1,
    props.reviewIterationStops?.length ?? 1,
  );
  const [iterationRange, setIterationRange] =
    React.useState<ReviewIterationRange>(
      () =>
        props.initialIterationRange ?? allReviewIterations(nativeUpdateCount),
    );
  const [historicalHtmlByKey, setHistoricalHtmlByKey] = React.useState<
    Record<string, string>
  >({});
  const [historicalSourceByKey, setHistoricalSourceByKey] = React.useState<
    Record<string, string>
  >({});
  const [historicalErrorByKey, setHistoricalErrorByKey] = React.useState<
    Record<string, string>
  >({});
  // PR-update endpoints where the file doesn't exist (added later / already
  // deleted). Native-iteration mode only: a normal state, not an error.
  const [historicalAbsentByKey, setHistoricalAbsentByKey] = React.useState<
    Record<string, true>
  >({});
  // Keyed by `path\u0000prId` (not PR id alone): one PR can change several
  // documents and `loadThreadsForPr` returns threads filtered to a path, so a
  // PR-id-only key would leak one document's threads onto another at the same PR.
  const [historicalThreadsByKey, setHistoricalThreadsByKey] = React.useState<
    Record<string, CommentThread[]>
  >({});

  const docHistory = completedPrHistoryEnabled
    ? (historyByPath[selectedPath] ?? EMPTY_DOC_HISTORY)
    : EMPTY_DOC_HISTORY;
  const completedPrHistoryStops = React.useMemo(
    () => buildHistoryStops(effectiveRoutedPr?.prId ?? null, docHistory),
    [effectiveRoutedPr, docHistory],
  );
  const historyStops = nativeIterationMode
    ? props.reviewIterationStops!
    : completedPrHistoryStops;
  const resolvedIterationRange = resolveReviewIterationRange(
    iterationRange,
    historyStops.length,
  );
  const clampedStopIndex = nativeIterationMode
    ? resolvedIterationRange.activeStopIndex
    : Math.min(completedHistoryStopIndex, historyStops.length - 1);
  const comparingIterations =
    nativeIterationMode && !resolvedIterationRange.isAllChanges;
  const activeStopIndex = nativeIterationMode
    ? resolvedIterationRange.activeStopIndex
    : clampedStopIndex;
  const baselineStopIndex = nativeIterationMode
    ? resolvedIterationRange.baselineStopIndex
    : clampedStopIndex;
  const activeStop = historyStops[activeStopIndex]!;
  const baselineStop =
    baselineStopIndex == null ? undefined : historyStops[baselineStopIndex];
  const viewingHistorical = !activeStop.isCurrent;

  // Report the compared PR updates up so the host can mirror them into the
  // route and shared links (`null` = All updates). Keyed on the comparison's
  // value; the callback is read through a ref so an inline host callback
  // doesn't re-fire it on every render.
  const onIterationRangeChangeRef = React.useRef(props.onIterationRangeChange);
  onIterationRangeChangeRef.current = props.onIterationRangeChange;
  const reportedRangeKey = nativeIterationMode
    ? resolvedIterationRange.isAllChanges
      ? "all"
      : `${resolvedIterationRange.range.fromUpdate}-${resolvedIterationRange.range.toUpdate}`
    : null;
  React.useEffect(() => {
    if (reportedRangeKey === null) return;
    onIterationRangeChangeRef.current?.(
      resolvedIterationRange.isAllChanges ? null : resolvedIterationRange.range,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the comparison's value, not its object identity
  }, [reportedRangeKey]);

  // Which files the compared updates touch, so the file list can mark them and
  // dim the rest. Cached per comparison; a failed load just leaves the
  // PR-wide indicators in place.
  const loadRangeChanges = props.loadRangeChanges;
  const [rangeChangesByKey, setRangeChangesByKey] = React.useState<
    Record<string, Readonly<Record<string, ChangeType>>>
  >({});
  const rangeChangesKey =
    nativeIterationMode && !resolvedIterationRange.isAllChanges
      ? reportedRangeKey
      : null;
  React.useEffect(() => {
    if (
      !loadRangeChanges ||
      rangeChangesKey === null ||
      rangeChangesByKey[rangeChangesKey]
    ) {
      return;
    }
    loadRangeChanges(resolvedIterationRange.range)
      .then((byPath) =>
        setRangeChangesByKey((prev) => ({
          ...prev,
          [rangeChangesKey]: byPath,
        })),
      )
      .catch((err: unknown) => {
        console.warn("[PrShell] loadRangeChanges failed:", err);
        trackUserFacingError({
          error: err,
          source: "PrShell.updates",
          operation: "range-changes-load",
          impact: "degraded",
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the comparison's value
  }, [loadRangeChanges, rangeChangesKey, rangeChangesByKey]);
  const docNavRangeChanges =
    rangeChangesKey !== null && rangeChangesByKey[rangeChangesKey]
      ? {
          label: reviewRangeLabel(
            resolvedIterationRange.range,
            historyStops.length,
          ),
          byPath: rangeChangesByKey[rangeChangesKey],
        }
      : undefined;

  const [threadState, dispatch] = React.useReducer(
    threadReducer,
    initialThreadState(initialThreads),
  );

  // Seed the identity store for free from everyone we already know: the current
  // user plus every comment author. This resolves the common `@<GUID>` mentions
  // (self, PR participants) with zero network. Referenced-but-unknown mention
  // ids (people who aren't participants) are prefetched in one batch so their
  // names resolve on load, rather than flashing a raw GUID until each pill
  // happens to render.
  React.useEffect(() => {
    const people: Array<{
      id: string;
      displayName?: string;
      avatarUrl?: string;
    }> = [currentUser];
    const mentionIds: string[] = [];
    for (const id of threadState.order) {
      const t = threadState.threadsById[id];
      /* v8 ignore next -- order ids always have a thread entry */
      if (!t) continue;
      // Seed names ADO already resolved for this thread's @mentions. This is
      // the authoritative source (works even in personal-MSA orgs where the
      // by-id identities endpoint returns null), so mentions render as names on
      // load with no network call.
      if (t.mentionedIdentities) people.push(...t.mentionedIdentities);
      for (const c of t.comments) {
        people.push(c.author);
        mentionIds.push(...collectUserMentionIds(c.bodyMarkdown));
      }
    }
    identityStore.seed(people);
    // `ensure` skips ids already known (e.g. seeded authors) and coalesces the
    // rest into a single resolver call.
    if (mentionIds.length > 0) identityStore.ensure(mentionIds);
  }, [threadState, currentUser, identityStore]);

  // Background remote-thread sync; merges snapshots preserving optimistic writes.
  const onRemoteThreads = React.useCallback((threads: CommentThread[]) => {
    dispatch({ type: "MERGE_REMOTE_THREADS", threads });
  }, []);
  // A PR-wide snapshot (`fetchRemoteThreads`) holds every thread, so it lets a
  // `?comment=` deep link tell "not loaded yet" from "doesn't exist". A
  // per-document snapshot can't: it only covers whichever file was open.
  const [prThreadSnapshots, setPrThreadSnapshots] = React.useState(0);
  const onPrThreads = React.useCallback((threads: CommentThread[]) => {
    dispatch({ type: "MERGE_REMOTE_THREADS", threads });
    setPrThreadSnapshots((n) => n + 1);
  }, []);
  const noopFetch = React.useCallback(
    /* v8 ignore next -- fallback fetch, only wired up when fetchRemoteThreads is absent */
    (_signal: AbortSignal): Promise<CommentThread[]> => Promise.resolve([]),
    [],
  );
  // Per-document mode: poll the *currently selected* document's threads. The
  // closure reads `selectedPathRef` so its identity stays stable across file
  // switches while always targeting the active document.
  const loadThreadsForPath = props.loadThreadsForPath;
  const perPathFetch = React.useCallback(
    /* v8 ignore start -- guard only; perPathFetch is wired solely when loadThreadsForPath is set */
    (_signal: AbortSignal): Promise<CommentThread[]> =>
      loadThreadsForPath
        ? loadThreadsForPath(selectedPathRef.current)
        : Promise.resolve([]),
    /* v8 ignore stop */
    [loadThreadsForPath],
  );
  const effectiveFetch =
    props.fetchRemoteThreads ?? (loadThreadsForPath ? perPathFetch : undefined);
  const threadSync = useThreadSync({
    enabled: !!effectiveFetch,
    fetchThreads: effectiveFetch ?? noopFetch,
    onThreads: props.fetchRemoteThreads ? onPrThreads : onRemoteThreads,
    intervalMs: props.threadSyncIntervalMs,
    // Resume polling the moment the ADO session is re-minted.
    subscribeRecovered: adoSession.onRecovered,
  });

  // Unified data refresh surfaced on the reading toolbar: pull a fresh comment
  // snapshot AND (when the host provides one) reload the file list in one click
  // — replacing the separate per-header refresh buttons. Gated on comment
  // refreshability, which every reader surface has; hosts that also expose a
  // file reload pass `onRefreshFiles` to fold it into the same click.
  const canRefreshComments = !!effectiveFetch;
  const onRefreshFiles = props.onRefreshFiles;
  // A host file reload can be async and slower than the comment poll. Track it
  // so the toolbar stays "refreshing" until BOTH settle — otherwise the button
  // re-enables the moment the poll finishes and a slow file reload could be
  // fired again while the first is still running.
  const [fileRefreshInFlight, setFileRefreshInFlight] = React.useState(false);
  const handleRefresh = React.useCallback(() => {
    // `refreshNow` is a safe no-op when thread sync is disabled, so no guard.
    threadSync.refreshNow();
    track(events.commentsRefreshed());
    if (!onRefreshFiles) return;
    setFileRefreshInFlight(true);
    // Normalize to a promise so a sync or async host reload is handled the
    // same; its rejection is logged, never left unhandled.
    void Promise.resolve(onRefreshFiles())
      .catch((err: unknown) => {
        console.warn("[PrShell] file refresh failed:", err);
        trackUserFacingError({
          error: err,
          source: "PrShell.refresh",
          operation: "file-refresh",
          impact: "action-failed",
        });
      })
      .finally(() => setFileRefreshInFlight(false));
  }, [threadSync, onRefreshFiles]);
  const refreshLabel = onRefreshFiles
    ? "Refresh files and comments"
    : "Refresh comments";

  // Per-document mode: load the selected file's threads the first time it's
  // opened (the poller above keeps the active file fresh thereafter).
  const loadedThreadPathsRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    if (!loadThreadsForPath || !selectedPath) return;
    if (loadedThreadPathsRef.current.has(selectedPath)) return;
    loadedThreadPathsRef.current.add(selectedPath);
    let cancelled = false;
    loadThreadsForPath(selectedPath)
      .then((threads) => {
        /* v8 ignore start -- cleanup races ahead of a slow resolve; not deterministically reproducible in tests */
        if (cancelled) {
          return;
        }
        /* v8 ignore stop */
        dispatch({ type: "MERGE_REMOTE_THREADS", threads });
      })
      .catch((err: unknown) => {
        // Allow a retry on the next selection of this path.
        loadedThreadPathsRef.current.delete(selectedPath);

        console.warn("[PrShell] loadThreadsForPath failed:", err);
        trackUserFacingError({
          error: err,
          source: "PrShell.comments",
          operation: "comments-load",
          impact: "degraded",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [loadThreadsForPath, selectedPath]);

  // ---- comment-history stepper effects ----
  // Always start a freshly-opened document at its live "Current" head: a
  // Documents-hub history is per document.
  React.useEffect(() => {
    setCompletedHistoryStopIndex(0);
  }, [selectedPath]);
  // A PR's updates are PR-wide, so the chosen comparison (e.g. "Update 4 → 5")
  // carries across files — reviewers step through a PR's files at one update.
  // It only resets if the set of updates itself changes (not on mount, which
  // would discard a comparison opened from a shared link).
  const updateCountRef = React.useRef(nativeUpdateCount);
  React.useEffect(() => {
    if (updateCountRef.current === nativeUpdateCount) return;
    updateCountRef.current = nativeUpdateCount;
    setIterationRange(allReviewIterations(nativeUpdateCount));
  }, [nativeUpdateCount]);

  // Load the selected document's review history the first time it's opened.
  const loadedHistoryPathsRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    if (!completedPrHistoryEnabled || !loadDocHistory || !selectedPath) return;
    if (loadedHistoryPathsRef.current.has(selectedPath)) return;
    loadedHistoryPathsRef.current.add(selectedPath);
    let cancelled = false;
    loadDocHistory(selectedPath)
      .then((refs) => {
        /* v8 ignore next -- cleanup races ahead of a slow resolve */
        if (cancelled) return;
        setHistoryByPath((prev) => ({ ...prev, [selectedPath]: refs }));
      })
      .catch((err: unknown) => {
        // Allow a retry on the next selection of this path.
        loadedHistoryPathsRef.current.delete(selectedPath);

        console.warn("[PrShell] loadDocHistory failed:", err);
        trackUserFacingError({
          error: err,
          source: "PrShell.history",
          operation: "history-list-load",
          impact: "degraded",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [completedPrHistoryEnabled, loadDocHistory, selectedPath]);

  // Load source + rendered HTML for every historical endpoint needed by the
  // current selection. A range may need two commits; single selection needs one.
  const historicalContentKey =
    viewingHistorical && activeStop.commitId
      ? `${selectedPath}\u0000${activeStop.commitId}`
      : null;
  const baselineCommitId =
    baselineStop?.commitId ?? props.reviewIterationBaseCommit;
  const baselineContentKey = comparingIterations
    ? `${selectedPath}\u0000${baselineCommitId!}`
    : null;
  const historicalLoadTargets = React.useMemo(() => {
    const targets = new Map<string, string>();
    if (historicalContentKey && activeStop.commitId) {
      targets.set(historicalContentKey, activeStop.commitId);
    }
    if (baselineContentKey && baselineCommitId) {
      targets.set(baselineContentKey, baselineCommitId);
    }
    return [...targets].map(([key, commitId]) => ({ key, commitId }));
  }, [
    historicalContentKey,
    activeStop.commitId,
    baselineContentKey,
    baselineCommitId,
  ]);
  React.useEffect(() => {
    if (!loadFileSourceAt || historicalLoadTargets.length === 0) return;
    let cancelled = false;
    for (const target of historicalLoadTargets) {
      if (
        historicalErrorByKey[target.key] !== undefined ||
        historicalAbsentByKey[target.key] ||
        (historicalHtmlByKey[target.key] !== undefined &&
          historicalSourceByKey[target.key] !== undefined)
      ) {
        continue;
      }
      void loadFileSourceAt(selectedPath, target.commitId)
        .then(async (source) => {
          /* v8 ignore next -- bails if the selection changed mid-load */
          if (cancelled) return;
          const html = await renderMarkdown(source);
          /* v8 ignore next -- bails if the selection changed mid-render */
          if (cancelled) return;
          setHistoricalSourceByKey((prev) => ({
            ...prev,
            [target.key]: source,
          }));
          setHistoricalHtmlByKey((prev) => ({
            ...prev,
            [target.key]: html,
          }));
        })
        .catch((err: unknown) => {
          /* v8 ignore next -- cleanup races ahead of a rejected request */
          if (cancelled) return;
          // Comparing PR updates: the file legitimately may not exist at an
          // endpoint (the PR adds it later, or deleted it already).
          if (nativeIterationMode && isItemNotFoundError(err)) {
            setHistoricalAbsentByKey((prev) => ({
              ...prev,
              [target.key]: true,
            }));
            return;
          }
          console.warn("[PrShell] loadFileSourceAt failed:", err);
          trackUserFacingError({
            error: err,
            source: "PrShell.history",
            operation: "history-content-load",
            impact: "action-failed",
          });
          setHistoricalErrorByKey((prev) => ({
            ...prev,
            [target.key]: errorMessage(err),
          }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [
    loadFileSourceAt,
    selectedPath,
    historicalLoadTargets,
    historicalErrorByKey,
    historicalAbsentByKey,
    historicalHtmlByKey,
    historicalSourceByKey,
    nativeIterationMode,
  ]);

  // Load the active historical stop PR's threads (read-only).
  const activeHistoricalPrId =
    viewingHistorical && !nativeIterationMode ? activeStop.prId : null;
  React.useEffect(() => {
    if (activeHistoricalPrId == null || !loadThreadsForPr) return;
    const key = `${selectedPath}\u0000${activeHistoricalPrId}`;
    if (historicalThreadsByKey[key]) return;
    let cancelled = false;
    loadThreadsForPr(activeHistoricalPrId, selectedPath)
      .then((threads) => {
        /* v8 ignore next -- cleanup races ahead of a slow resolve */
        if (cancelled) return;
        setHistoricalThreadsByKey((prev) => ({
          ...prev,
          [key]: threads,
        }));
      })
      .catch((err: unknown) => {
        console.warn("[PrShell] loadThreadsForPr failed:", err);
        trackUserFacingError({
          error: err,
          source: "PrShell.history",
          operation: "history-comments-load",
          impact: "degraded",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeHistoricalPrId,
    loadThreadsForPr,
    selectedPath,
    historicalThreadsByKey,
  ]);

  // Per-file rendered HTML cache.
  const [htmlByPath, setHtmlByPath] = React.useState<Record<string, string>>(
    {},
  );
  // Per-file committed Markdown source cache; used to anchor comments against
  // the exact source that produced the rendered article.
  const [sourceByPath, setSourceByPath] = React.useState<
    Record<string, string>
  >({});
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Documents hub: a remembered or linked document that's no longer in the
  // repo (renamed / deleted) was swapped for another one; tell the reader.
  const [missingDoc, setMissingDoc] = React.useState<{
    missing: string;
    shown: string;
  } | null>(null);
  // Decides what a "not found" document load means — assigned every render
  // below (after the deep-link refs it resets), so the load effect can call it
  // without depending on the file list.
  const handleMissingDocRef = React.useRef<
    (missing: string) => "replaced" | "expected" | "unexpected"
  >(null!);
  const [renderVersion, setRenderVersion] = React.useState(0);
  const [navigationActivities, setNavigationActivities] = React.useState<
    readonly ReaderActivity[]
  >([]);

  // Comment rail search query (filters comments by body / author).
  const [commentQuery, setCommentQuery] = React.useState("");

  React.useEffect(() => {
    /* v8 ignore next -- selectedPath is always set once a file is selected */
    if (!selectedPath) return;
    if (htmlByPath[selectedPath]) {
      setRenderVersion((v) => v + 1);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadFileSource(selectedPath)
      .then(async (source) => {
        /* v8 ignore next -- bails if the selected file changed mid-load */
        if (cancelled) return;
        const html = await renderMarkdown(source);
        /* v8 ignore next -- bails if the selected file changed mid-render */
        if (cancelled) return;
        setSourceByPath((prev) => ({ ...prev, [selectedPath]: source }));
        setHtmlByPath((prev) => ({ ...prev, [selectedPath]: html }));
        setLoading(false);
        setRenderVersion((v) => v + 1);
      })
      .catch((err: unknown) => {
        /* v8 ignore next -- bails if the selected file changed before the error surfaced */
        if (cancelled) return;
        const missing = isItemNotFoundError(err)
          ? handleMissingDocRef.current(selectedPath)
          : "unexpected";
        if (missing === "replaced") return;
        if (missing === "unexpected") {
          trackUserFacingError({
            error: err,
            source: "PrShell.documentLoad",
            operation: "document-load",
            impact: "blocking",
          });
        }
        setError(errorMessage(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPath, loadFileSource, htmlByPath]);

  // Boot-time signal: the experience is "loaded" the moment the first
  // document's Markdown has been committed to the DOM — not when React first
  // mounted. Boot completes on the TERMINAL outcome of the first document's
  // content load: success ("content") OR a load/render failure ("error").
  // Gating only on success would silently drop the boot event whenever the
  // first file can't be fetched or rendered, so the dependent (boot completion)
  // deterministically awaits the actual settle of the content fetch rather than
  // assuming content will always appear. Fires once (markAppReady is idempotent
  // + no-ops outside a real boot, e.g. Storybook). Runs in an effect so it
  // lands after commit/paint.
  const bootReadyFiredRef = React.useRef(false);
  React.useEffect(() => {
    if (bootReadyFiredRef.current) return;
    const hasRenderedHtmlForSelected =
      !!selectedPath &&
      Object.prototype.hasOwnProperty.call(htmlByPath, selectedPath);
    if (hasRenderedHtmlForSelected) {
      bootReadyFiredRef.current = true;
      markAppReady("content");
    } else if (error) {
      bootReadyFiredRef.current = true;
      markAppReady("error");
    }
  }, [htmlByPath, selectedPath, error]);

  // -------------------------------------------------------------------------
  // Derived data
  // -------------------------------------------------------------------------
  const allThreadsForFile = React.useMemo(
    () => selectThreadsByFile(threadState, selectedPath),
    [threadState, selectedPath],
  );

  // The writable "Current" head's threads for this file (from the live reducer
  // state / poller). When the stepper is parked on a historical stop we show
  // that PR's threads instead — read-only, loaded on demand and cached by id.
  const currentThreadsRaw = React.useMemo(() => {
    if (viewingHistorical && !nativeIterationMode) {
      /* v8 ignore start -- historical-PR view branch; not exercised in the unit/storybook harness */
      return activeStop.prId != null
        ? (historicalThreadsByKey[`${selectedPath}\u0000${activeStop.prId}`] ??
            EMPTY_THREADS)
        : EMPTY_THREADS;
      /* v8 ignore stop */
    }
    return allThreadsForFile;
  }, [
    viewingHistorical,
    nativeIterationMode,
    activeStop.prId,
    selectedPath,
    historicalThreadsByKey,
    allThreadsForFile,
  ]);

  // General PR-level ("Overview") comments — not tied to any file. Suppressed
  // in the hub (single-file, latest-master context — see `isHub`).
  const generalThreads = React.useMemo(
    () => (isHub ? EMPTY_THREADS : selectGeneralThreads(threadState)),
    [threadState, isHub],
  );

  // Threads anchored to a file that is NO LONGER part of this PR (the file was
  // removed from the PR's change set, so it has no tab and can never be opened
  // here). These would otherwise be unreachable, so they get their own tray
  // below the General section. NOTE: this is strictly "file gone from the PR" —
  // comments on files that ARE still in the PR belong to those files and show
  // when the reader opens them, never here. Suppressed in the hub (`isHub`):
  // there's no change-set to leave, and its file list is a partial lazy tree.
  const orphanedFileThreads = React.useMemo(() => {
    if (isHub) return EMPTY_THREADS;
    const inPr = new Set(pr.files.map((f) => f.path));
    const out: CommentThread[] = [];
    for (const id of threadState.order) {
      const t = threadState.threadsById[id];
      /* v8 ignore next -- defensive: order ids always have a thread entry */
      if (!t) continue;
      // General/Overview threads have their own tray (an empty filePath always
      // means general in our data model, so this also covers file-less threads).
      if (t.general) continue;
      if (inPr.has(t.filePath)) continue;
      out.push(t);
    }
    return out;
  }, [threadState, pr.files, isHub]);

  // Threads passed to ArticleView for anchoring: only those matching the
  // active comment filter (all / active / resolved / mine) are highlighted in
  // the prose, so the article and the rail always agree on what's shown.
  const visibleForArticle = React.useMemo(() => {
    const out: CommentThread[] = [];
    for (const t of currentThreadsRaw) {
      if (
        threadVisibleForCommentView(
          t,
          commentQuery,
          commentFilter,
          currentUser.id,
        )
      ) {
        out.push(t);
      }
    }
    return out;
  }, [currentThreadsRaw, commentQuery, commentFilter, currentUser.id]);

  const threadCountsByPath: Record<string, number> = React.useMemo(() => {
    const out: Record<string, number> = {};
    for (const id of threadState.order) {
      const t = threadState.threadsById[id];
      /* v8 ignore next -- defensive: order ids always have a thread entry */
      if (!t) continue;
      if (isResolvedLike(t.status)) continue;
      out[t.filePath] = (out[t.filePath] ?? 0) + 1;
    }
    return out;
  }, [threadState]);

  // -------------------------------------------------------------------------
  // Anchor layout (Y positions) — reported by ArticleView via callback.
  // -------------------------------------------------------------------------
  const [anchorLayout, setAnchorLayout] = React.useState<AnchorLayout>({
    yByThreadId: new Map(),
    orphanedThreadIds: [],
  });

  const onAnchorsResolved = React.useCallback(
    (layout: AnchorLayout, dY: number | null) => {
      setAnchorLayout(layout);
      setDraftY(dY);
    },
    [],
  );

  // ESC clears the active thread and dismisses an *empty* draft from anywhere
  // outside a text editor. A draft holding text is preserved (users must cancel
  // it explicitly). (Composer has its own ESC handler that stops propagation.)
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      /* v8 ignore next -- Escape inside a textarea/input is handled by the composer */
      if (target && target.matches("textarea, input")) return;
      setActiveThreadId(clearIfSet);
      dismissEmptyDraftRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Clicking outside a highlight, balloon, or selection bubble dismisses the
  // active thread and any *empty* draft — the priority-stacked layout is
  // strictly transient. A draft with text survives a stray click.
  React.useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      // A target that its own click handler removed from the DOM (e.g. a
      // mention-picker row that commits and unmounts) is detached by the time
      // this bubbles to document; `closest` can no longer see its `.emr-balloon`
      // ancestor. Such a click came from our own UI, so it must not dismiss.
      if (!target.isConnected || isCommentUiClickTarget(target)) return;
      setActiveThreadId(clearIfSet);
      dismissEmptyDraftRef.current();
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // When a thread becomes active, bring its balloon into view inside the rail's
  // OWN scroll (the rail scrolls independently of the document now). The
  // document is scrolled to the anchor by the selection handlers. One effect
  // centralises rail-follow for every activation path (click, cycle, deep link).
  React.useEffect(() => {
    if (!activeThreadId) return;
    const escaped = CSS.escape(activeThreadId);
    let cancelled = false;
    // rAF #1 lets React commit the list; rAF #2 lets layout settle.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        /* v8 ignore next -- bails if the active thread changed between rAFs */
        if (cancelled) return;
        /* v8 ignore next -- scrollIntoView is inert in headless tests */
        document
          .querySelector(
            `.emr-rail-col .emr-balloon[data-thread-id="${escaped}"]`,
          )
          // `start` + the balloon's `scroll-margin-top` (CSS) lands the comment
          // just below the sticky rail header, so its top is fully in view
          // instead of tucked under the "COMMENTS" strip.
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [activeThreadId]);

  // Deep-link consumption (`?comment=`). Holds the thread to auto-open until
  // its anchor mounts — the linked document's threads may still be loading, or
  // the article may not have wrapped its highlights yet. Re-runs as the
  // document and thread set settle; once the anchor exists we activate +
  // center it and clear the seed so later navigation isn't hijacked.
  const pendingActiveThreadIdRef = React.useRef<string | undefined>(
    props.initialActiveThreadId,
  );
  React.useEffect(() => {
    // Latch the seed only when present. Hosts that gate the prop (e.g. the
    // Documents hub clears it after the first mount so it can't hijack later
    // navigation) flip it back to `undefined` on the next re-render — which
    // often lands BEFORE the linked document has finished its async render.
    // Overwriting the ref with that `undefined` would drop the deep link and
    // the thread would never auto-open. So we never clear it from props; the
    // consumption effect below clears it once the anchor is found.
    if (props.initialActiveThreadId) {
      pendingActiveThreadIdRef.current = props.initialActiveThreadId;
    }
  }, [props.initialActiveThreadId]);
  React.useEffect(() => {
    const tid = pendingActiveThreadIdRef.current;
    if (!tid) return;
    let cancelled = false;
    // One rAF lets React commit the current document + the highlight-wrapping
    // layout effect run, so the anchor (or balloon) is queryable.
    const handle = window.requestAnimationFrame(() => {
      /* v8 ignore next -- bails if the seed was consumed between frames */
      if (cancelled) return;
      // `tid` comes from the user-controlled `?comment=` route param, so escape
      // it before interpolating into a selector — metacharacters like `"` or
      // `]` would otherwise make `querySelector` throw and break deep linking.
      const escaped = CSS.escape(tid);
      let target: HTMLElement | null;
      try {
        target =
          document.querySelector<HTMLElement>(
            `.markdown-body [data-thread-id="${escaped}"]`,
          ) ??
          document.querySelector<HTMLElement>(
            `.emr-rail-col .emr-balloon[data-thread-id="${escaped}"]`,
          );
      } catch {
        /* v8 ignore next 2 -- defensive: CSS.escape yields a valid selector */
        return;
      }
      // Not mounted yet — leave the seed pending; a later threads/path change
      // or anchor re-resolution re-runs this effect once the linked document's
      // highlight has been wrapped into the DOM. But once a PR-wide thread
      // snapshot has arrived without it, the thread doesn't exist (deleted,
      // or a bad link): record that once and stop waiting.
      if (!target) {
        if (prThreadSnapshots > 0 && !threadState.threadsById[tid]) {
          pendingActiveThreadIdRef.current = undefined;
          track(events.linkOpened({ target: "comment", found: false }));
        }
        return;
      }
      pendingActiveThreadIdRef.current = undefined;
      setActiveThreadId(tid);
      track(events.linkOpened({ target: "comment", found: true }));
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(handle);
    };
    // `anchorLayout` is the signal that ArticleView has (re)wrapped the
    // highlight spans — `renderVersion`/`threadState` change when the document
    // or thread set settle, but the actual `[data-thread-id]` anchors land one
    // commit later via the async wrap pass. Depending on `anchorLayout` re-runs
    // this once the anchor is queryable, closing the deep-link race where the
    // rAF fired before the highlight existed.
  }, [
    selectedPath,
    threadState,
    prThreadSnapshots,
    renderVersion,
    anchorLayout,
    props.initialActiveThreadId,
  ]);

  // Two-way deep-link binding: report the active thread up so the host can
  // mirror it into the route's `?comment=` param. The inverse of the
  // consumption effect above — selecting a comment yields the same shareable
  // URL the "Link to comment" action builds. Seeded to `null` (matching the
  // initial `activeThreadId`) so mount doesn't clobber a freshly-read deep
  // link with an empty param; only genuine changes (deep-link consumption,
  // selection, or clear) propagate.
  const onActiveThreadChange = props.onActiveThreadChange;
  const lastReportedThreadRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!onActiveThreadChange) return;
    if (activeThreadId === lastReportedThreadRef.current) return;
    lastReportedThreadRef.current = activeThreadId;
    onActiveThreadChange(activeThreadId);
  }, [activeThreadId, onActiveThreadChange]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------
  // Scroll the DOCUMENT so a thread's anchored highlight is centred in view.
  // (The rail-follow effect scrolls the rail to the balloon separately.)
  const scrollDocToAnchor = React.useCallback((tid: string) => {
    window.requestAnimationFrame(() => {
      /* v8 ignore next -- scrollIntoView is inert in headless tests */
      document
        .querySelector(`.markdown-body [data-thread-id="${CSS.escape(tid)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  // Heading to scroll to once the selected document renders: a cross-document
  // `#anchor` link, or the `?anchor=` deep link seeded at mount (a `?comment=`
  // link wins when both are present — the thread's own scroll would fight the
  // heading's).
  const pendingScrollHashRef = React.useRef<string | null>(
    props.initialActiveThreadId ? null : (props.initialAnchor ?? null),
  );
  const pendingHashIsDeepLinkRef = React.useRef(
    pendingScrollHashRef.current !== null,
  );
  // Text to flash once the selected document renders (the `?text=` deep link
  // seeded at mount); the heading above is its fallback.
  const pendingTextRef = React.useRef<string | null>(
    props.initialActiveThreadId ? null : (props.initialTextFragment ?? null),
  );

  // Open a document in THIS reader (shared by the nav and in-document link
  // clicks): select it, drop the active thread, tear down an empty draft, and
  // report the change up so the host can reflect it in the route. A deep-link
  // heading still waiting on the previous document no longer applies.
  const onSelectPath = props.onSelectPath;
  const selectDocPath = React.useCallback(
    (path: string) => {
      pendingScrollHashRef.current = null;
      pendingHashIsDeepLinkRef.current = false;
      pendingTextRef.current = null;
      setMissingDoc(null);
      setSelectedPath(path);
      setActiveThreadId(null);
      dismissEmptyDraftRef.current();
      track(events.fileOpened({ source: "nav-click" }));
      onSelectPath?.(path);
    },
    [onSelectPath],
  );

  // A document that no longer exists (a stale `?path=` link or the hub's
  // remembered last document after a rename/delete). In the Documents hub this
  // is an expected state, not a failure: open the repo's first other document
  // instead — reporting it up so the route and the remembered path move on —
  // and say what happened. Elsewhere (the PR tab) it stays an error.
  handleMissingDocRef.current = (missing) => {
    if (!props.documentsMode) return "unexpected";
    // Fall back once: if the replacement is missing too, stop there rather
    // than bouncing between missing documents.
    if (missingDoc?.shown === missing) return "expected";
    const next = pr.files.find((f) => f.path !== missing)?.path;
    if (!next) return "expected";
    // A deep-link heading/text targeted the missing document; drop it.
    pendingScrollHashRef.current = null;
    pendingHashIsDeepLinkRef.current = false;
    pendingTextRef.current = null;
    setMissingDoc({ missing, shown: next });
    setLoading(false);
    setSelectedPath(next);
    onSelectPath?.(next);
    return "replaced";
  };

  // Scroll the document to an anchor target (a heading slug from an `#anchor`
  // link or an `?anchor=` deep link). Resolves foreign slug styles, unfolds
  // any collapsed section hiding the target, and replays the landing cue.
  // `hold` keeps the target aligned while late content (diff decorations,
  // highlights, diagrams, images) settles — used whenever the document was
  // just opened, where that async layout would otherwise push it off-screen.
  // Returns via rAF so the just-committed article is queryable.
  const activeStorageKeyRef = React.useRef(selectedPath);
  const releaseScrollHoldRef = React.useRef<(() => void) | null>(null);
  const stopLandingCueRef = React.useRef<(() => void) | null>(null);
  React.useEffect(
    () => () => {
      releaseScrollHoldRef.current?.();
      stopLandingCueRef.current?.();
    },
    [],
  );
  const scrollDocToHash = React.useCallback(
    (
      hash: string,
      opts?: {
        hold?: boolean;
        focus?: boolean;
        onResolved?: (found: boolean) => void;
      },
    ) => {
      if (!hash) return;
      window.requestAnimationFrame(() => {
        const article = document.querySelector<HTMLElement>(
          ".emr-article-wrap > .emr-rendered",
        );
        /* v8 ignore next -- the article is mounted whenever a document has rendered */
        if (!article) return;
        const target = findAnchorTarget(article, hash);
        opts?.onResolved?.(target !== null);
        if (!target) return;
        revealAnchorTarget(target, activeStorageKeyRef.current);
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        // The article element persists across re-wraps (only its children are
        // replaced), so the landing cue and the scroll hold re-resolve the
        // target inside it each time.
        const resolveTarget = () => findAnchorTarget(article, hash);
        stopLandingCueRef.current?.();
        stopLandingCueRef.current = flashAnchorTarget(article, resolveTarget);
        // A link the user followed moves focus to its target, as native
        // fragment navigation does, so the next Tab and screen readers continue
        // from there. (Not for a mount-time deep link: that would steal focus
        // from the host page.)
        if (opts?.focus) {
          if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
          target.focus({ preventScroll: true });
        }
        releaseScrollHoldRef.current?.();
        releaseScrollHoldRef.current = opts?.hold
          ? holdScrollOnTarget(article, resolveTarget)
          : null;
      });
    },
    [],
  );

  // Scroll to and flash the text a `?text=` deep link quotes: unfold any
  // collapsed section hiding it, centre it, play the heading's landing cue on
  // the words themselves, and hold it in view while late content settles.
  // `onResolved` reports whether the text was found (the caller then falls
  // back to the section heading).
  const scrollDocToText = React.useCallback(
    (serialized: string, onResolved: (found: boolean) => void) => {
      window.requestAnimationFrame(() => {
        const article = document.querySelector<HTMLElement>(
          ".emr-article-wrap > .emr-rendered",
        );
        /* v8 ignore next -- the article is mounted whenever a document has rendered */
        if (!article) return;
        const fragment = parseTextFragment(serialized);
        const range = fragment ? findTextFragment(article, fragment) : null;
        onResolved(range !== null);
        if (!fragment || !range) return;
        revealAnchorTarget(
          range.startContainer.parentElement!,
          activeStorageKeyRef.current,
        );
        const resolveRange = () => findTextFragment(article, fragment);
        stopLandingCueRef.current?.();
        stopLandingCueRef.current = flashTextTarget(article, resolveRange);
        // The cue's first span is the scroll target; the hold lasts as long
        // as the cue (it re-finds the span after each re-wrap).
        const resolveTarget = () => currentTextCue(article);
        resolveTarget()?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        releaseScrollHoldRef.current?.();
        releaseScrollHoldRef.current = holdScrollOnTarget(
          article,
          resolveTarget,
          ANCHOR_TARGET_CUE_MS,
          "center",
        );
      });
    },
    [],
  );

  // A relative in-document link was clicked. Resolve it against the open file
  // and route it (see `routeDocLink`): scroll (in-page / self), select in place
  // (a PR file, or anywhere in the hub), open the Documents hub (Markdown
  // outside the PR), or hand a non-Markdown file to ADO's native Files view.
  // Returns true when consumed; external links return false and fall through.
  const onDocNavigate = props.onDocNavigate;
  const handleDocLink = React.useCallback(
    (href: string): boolean => {
      const action = routeDocLink(resolveDocLink(selectedPath, href), {
        isHub,
        currentPath: selectedPath,
        isInReader: (p) => pr.files.some((f) => samePath(f.path, p)),
      });
      if (action.type === "external") return false;
      if (action.type === "scroll") {
        scrollDocToHash(action.hash, { focus: true });
      } else if (action.type === "select") {
        selectDocPath(action.path);
        // Scroll to the linked heading once the new document has rendered.
        pendingScrollHashRef.current = action.hash || null;
        pendingHashIsDeepLinkRef.current = false;
      } else if (action.type === "open-file") {
        /* v8 ignore next -- onDocNavigate is optional; embeds without host nav omit it */
        onDocNavigate?.({ kind: "repo-file", path: action.path });
      } else {
        /* v8 ignore next -- onDocNavigate is optional; embeds without host nav omit it */
        onDocNavigate?.({
          kind: "hub-doc",
          path: action.path,
          hash: action.hash,
        });
      }
      return true;
    },
    [
      selectedPath,
      isHub,
      pr.files,
      onDocNavigate,
      selectDocPath,
      scrollDocToHash,
    ],
  );

  // Cross-document `#anchor` and the `?anchor=` deep link: see the effect
  // placed after the active article's render state (`articleReady`).

  const onHighlightClick = React.useCallback((tid: string) => {
    // The clicked highlight is already in view, so only select — the rail-follow
    // effect brings its balloon into view in the rail's own scroll.
    setActiveThreadId(tid);
  }, []);

  // "Copy link to section" (the heading link button). Only offered when the
  // host can build a shareable surface URL. On success the host is told so it
  // can mirror the anchor into the page URL, as ADO's own preview does.
  const buildDeepLink = useDeepLink();
  const onHeadingLinkCopied = props.onHeadingLinkCopied;
  const onCopyHeadingLink = React.useMemo(() => {
    if (!buildDeepLink) return undefined;
    return async (anchor: string): Promise<boolean> => {
      const url = buildDeepLink({ kind: "heading", anchor });
      const ok = url ? await copyText(url) : false;
      if (ok) {
        track(events.linkCopied({ target: "heading" }));
        onHeadingLinkCopied?.(anchor);
      } else {
        trackUserFacingError({
          error: new Error(
            url ? "Heading link copy failed" : "Heading link unavailable",
          ),
          source: "PrShell.copyHeadingLink",
          operation: "heading-link-copy",
          impact: "action-failed",
        });
      }
      return ok;
    };
  }, [buildDeepLink, onHeadingLinkCopied]);

  // "Copy link to selection" (the selection bubble's link action): links the
  // quoted text, with its section heading as a fallback.
  const onTextLinkCopied = props.onTextLinkCopied;
  const onCopySelectionLink = React.useMemo(() => {
    if (!buildDeepLink) return undefined;
    return async ({ text, anchor }: SelectionLinkTarget): Promise<boolean> => {
      const url = buildDeepLink({ kind: "text", text, anchor });
      const ok = url ? await copyText(url) : false;
      if (ok) {
        track(events.linkCopied({ target: "text" }));
        onTextLinkCopied?.(text, anchor);
      } else {
        trackUserFacingError({
          error: new Error(
            url ? "Text link copy failed" : "Text link unavailable",
          ),
          source: "PrShell.copySelectionLink",
          operation: "text-link-copy",
          impact: "action-failed",
        });
      }
      return ok;
    };
  }, [buildDeepLink, onTextLinkCopied]);

  const onSelectThread = React.useCallback(
    (tid: string) => {
      /* v8 ignore next -- no-op updater branch when the thread is already active */
      setActiveThreadId((curr) => (curr === tid ? curr : tid));
      scrollDocToAnchor(tid);
    },
    [scrollDocToAnchor],
  );

  // Cycle from the status bar: select the thread and scroll the document to its
  // anchor. The rail-follow effect reveals the balloon and auto-expands any
  // collapsed tray containing it. Replying remains an explicit rail action.
  const onCycleToThread = React.useCallback(
    (tid: string) => {
      setActiveThreadId(tid);
      track(events.commentNavigated());
      scrollDocToAnchor(tid);
    },
    [scrollDocToAnchor],
  );

  // A text selection requests a *new-comment* composer at that anchor, subject
  // to the one-active-draft guard. Comments attach to the latest version, so a
  // selection made while comparing an earlier update — which carries THAT
  // version's source lines — is positioned against the latest rendering right
  // away: the draft then stays correct however the comparison changes before
  // it's posted (the bubble only offers "Add comment" for text the latest
  // version still has; see `commentBlocker`).
  const onSelectionMade = React.useCallback(
    (anchor: TextQuoteAnchor) => {
      const path = selectedPathRef.current;
      requestDraft({
        path,
        threadId: NEW_DRAFT_THREAD_ID,
        anchor:
          nativeIterationMode && viewingHistorical
            ? /* v8 ignore start -- the bubble only opens a composer for text found in the latest version */
              (relocateAnchor(anchor, htmlByPath[path] ?? "") ?? anchor)
            : /* v8 ignore stop */
              anchor,
      });
    },
    [requestDraft, nativeIterationMode, viewingHistorical, htmlByPath],
  );

  const onAddImplicitComment = React.useCallback(() => {
    requestDraft(
      addCommentDraftTarget(activeDraftRef.current, selectedPathRef.current),
    );
  }, [requestDraft]);

  // A thread's "reply" trigger requests its reply composer, subject to the same
  // guard (an active draft elsewhere prompts the discard dialog first).
  const onRequestReply = React.useCallback(
    (threadId: string) => {
      requestDraft({
        path: selectedPathRef.current,
        threadId,
        anchor: null,
      });
    },
    [requestDraft],
  );

  const onCancelReply = React.useCallback(() => {
    draft.clear();
    setActiveDraft(null);
  }, [draft]);

  // Draft-guard dialog resolution. Discard drops the existing draft and opens
  // the composer the user asked for; keep-editing just dismisses the prompt.
  const onDiscardExistingDraft = React.useCallback(() => {
    const g = draftGuard;
    /* v8 ignore next -- the dialog only renders while draftGuard is set */
    if (!g) return;
    draft.clear();
    setDraftY(null);
    setActiveDraft(g.requested);
    revealComments();
    if (g.requested.threadId !== NEW_DRAFT_THREAD_ID) {
      setActiveThreadId(g.requested.threadId);
    }
    setDraftGuard(null);
  }, [draft, draftGuard, revealComments]);
  const onKeepExistingDraft = React.useCallback(() => setDraftGuard(null), []);

  // Wrap an async persistence call so errors surface in the rail banner. While
  // any write is in flight every composer's submit is disabled (see
  // ComposerBusyContext) — a write can be held for minutes through the ADO
  // token dead window, and a second click must not post a duplicate.
  const [writesInFlight, setWritesInFlight] = React.useState(0);
  // Open inline comment editors (see editorRegistry.ts): their text isn't kept
  // as a draft, so the reconnect notice hides "Reload page" while any is open.
  const [openEditors, setOpenEditors] = React.useState(0);
  const registerEditor = React.useCallback(() => {
    setOpenEditors((n) => n + 1);
    return () => setOpenEditors((n) => n - 1);
  }, []);
  const persistWith = React.useCallback(
    async <T,>(label: string, op: () => Promise<T>): Promise<T | null> => {
      setWritesInFlight((n) => n + 1);
      try {
        const result = await op();
        setPersistError(null);
        return result;
      } catch (err) {
        setPersistError(friendlyWriteError(label, err));

        console.error(`[PrShell] ${label} failed:`, err);
        trackUserFacingError({
          error: err,
          source: label,
          operation: "comment-write",
          impact: "action-failed",
        });
        return null;
      } finally {
        setWritesInFlight((n) => n - 1);
      }
    },
    [],
  );

  // A write can be held for minutes through the ADO session refresh. By the
  // time it lands the user may have cancelled this composer or started another
  // draft — only close and clear the composer still showing exactly what was
  // posted, never a newer draft.
  const isStillPostedDraft = React.useCallback(
    (postedTarget: DraftTarget | null, body: string): boolean =>
      activeDraftRef.current === postedTarget &&
      draft.getSnapshot().trim() === body,
    [draft],
  );

  const onSubmitDraft = React.useCallback(
    (body: string) => {
      // Anchor against the SAME source that produced the currently rendered
      // article so the comment can be located in it.
      /* v8 ignore next -- committed-source fallback is defensive */
      const source = sourceByPath[selectedPath] ?? "";
      const anchor = withSourceLocation(draftAnchor!, source);
      // Names the picker already resolved for this body's @mentions. Persisted
      // with the thread so they render on load even where ADO can't resolve the
      // id (cross-tenant guests / personal-MSA orgs).
      const mentions = collectMentionIdentities(body, (mid) =>
        identityStore.get(mid),
      );
      const postedTarget = activeDraftRef.current;
      void (async () => {
        const created = await persistWith("Create comment", () =>
          commentApi.createThread({
            filePath: selectedPath,
            anchor,
            bodyMarkdown: body,
            mentions,
          }),
        );
        /* v8 ignore next -- optimistic thread skipped when the remote write fails */
        if (!created) return;
        const thread = makeNewThread(
          created.threadId,
          selectedPath,
          anchor,
          currentUser,
          body,
          created.createdAt,
        );
        /* v8 ignore start -- a freshly created thread has exactly one comment, so the else-arm is unreachable */
        thread.comments = thread.comments.map((c, i) =>
          i === 0 ? { ...c, id: created.firstCommentId } : c,
        );
        /* v8 ignore stop */
        /* v8 ignore next -- exercised only when the new comment carries no @mentions */
        if (mentions.length > 0) thread.mentionedIdentities = mentions;
        dispatch({ type: "ADD_THREAD", thread });
        track(
          events.commentCreated({
            anchorKind: anchorKindOf(anchor),
            bodyLength: body.length,
          }),
        );
        if (!isStillPostedDraft(postedTarget, body)) return;
        setActiveDraft(null);
        setDraftY(null);
        setActiveThreadId(thread.id);
        draft.clear();
      })();
    },
    [
      draftAnchor,
      selectedPath,
      sourceByPath,
      currentUser,
      commentApi,
      persistWith,
      identityStore,
      draft,
      isStillPostedDraft,
    ],
  );

  const onCancelDraft = React.useCallback(() => {
    setActiveDraft(null);
    setDraftY(null);
    draft.clear();
  }, [draft]);

  const onReply = React.useCallback(
    (threadId: string, body: string) => {
      const postedTarget = activeDraftRef.current;
      void (async () => {
        const created = await persistWith("Add reply", () =>
          commentApi.addReply(threadId, body),
        );
        if (!created) return;
        dispatch({
          type: "ADD_REPLY",
          threadId,
          comment: {
            id: created.commentId,
            author: currentUser,
            bodyMarkdown: body,
            createdAt: created.createdAt,
          },
        });
        track(events.commentReplied({ bodyLength: body.length }));
        if (!isStillPostedDraft(postedTarget, body)) return;
        draft.clear();
        setActiveDraft(null);
      })();
    },
    [currentUser, commentApi, persistWith, draft, isStillPostedDraft],
  );

  const onResolve = React.useCallback(
    (tid: string) => {
      void (async () => {
        const ok = await persistWith("Resolve thread", () =>
          commentApi.setStatus(tid, "resolved"),
        );
        /* v8 ignore next -- optimistic update skipped when the remote write fails */
        if (ok === null) return;
        dispatch({ type: "SET_STATUS", threadId: tid, status: "resolved" });
        track(events.threadResolved());
      })();
    },
    [commentApi, persistWith],
  );

  const onReopen = React.useCallback(
    (tid: string) => {
      void (async () => {
        const ok = await persistWith("Reopen thread", () =>
          commentApi.setStatus(tid, "active"),
        );
        /* v8 ignore next -- optimistic update skipped when the remote write fails */
        if (ok === null) return;
        dispatch({ type: "SET_STATUS", threadId: tid, status: "active" });
        track(events.threadReopened());
      })();
    },
    [commentApi, persistWith],
  );

  // Mark a thread as pending — a lightweight "revisit later" state that keeps
  // it open (still counted, still shown) but visually distinct.
  const onMarkPending = React.useCallback(
    (tid: string) => {
      void (async () => {
        const ok = await persistWith("Mark thread pending", () =>
          commentApi.setStatus(tid, "pending"),
        );
        /* v8 ignore next -- optimistic update skipped when the remote write fails */
        if (ok === null) return;
        dispatch({ type: "SET_STATUS", threadId: tid, status: "pending" });
        track(events.threadMarkedPending());
      })();
    },
    [commentApi, persistWith],
  );

  // Close a thread — a terminal state (folded away with resolved) for threads
  // that are done but weren't a code-fix resolution.
  const onCloseThread = React.useCallback(
    (tid: string) => {
      void (async () => {
        const ok = await persistWith("Close thread", () =>
          commentApi.setStatus(tid, "closed"),
        );
        /* v8 ignore next -- optimistic update skipped when the remote write fails */
        if (ok === null) return;
        dispatch({ type: "SET_STATUS", threadId: tid, status: "closed" });
        track(events.threadClosed());
      })();
    },
    [commentApi, persistWith],
  );

  const onEditComment = React.useCallback(
    async (
      threadId: string,
      commentId: string,
      newBodyMarkdown: string,
    ): Promise<boolean> => {
      const result = await persistWith("Edit comment", () =>
        commentApi.editComment(threadId, commentId, newBodyMarkdown),
      );
      // A failed save leaves the editor open with the user's text (CommentRow).
      if (!result) return false;
      dispatch({
        type: "EDIT_COMMENT",
        threadId,
        commentId,
        newBodyMarkdown,
        updatedAt: result.updatedAt,
      });
      track(events.commentEdited());
      return true;
    },
    [commentApi, persistWith],
  );

  const onDeleteComment = React.useCallback(
    (threadId: string, commentId: string) => {
      void (async () => {
        const ok = await persistWith("Delete comment", () =>
          commentApi.deleteComment(threadId, commentId),
        );
        /* v8 ignore next -- optimistic update skipped when the remote write fails */
        if (ok === null) return;
        dispatch({ type: "DELETE_COMMENT", threadId, commentId });
        track(events.commentDeleted());
        // Deleting the last comment removes the thread — clear active.
        setActiveThreadId(clearIfEquals(threadId));
      })();
    },
    [commentApi, persistWith],
  );

  const onDeleteThread = React.useCallback(
    (threadId: string) => {
      const thread = threadState.threadsById[threadId]!;
      void (async () => {
        // Delete every comment server-side, then drop the thread locally even
        // on error to avoid stranding ghost UI.
        const ok = await persistWith("Delete thread", async () => {
          // Replies first, root last: deleting the root may remove/invalidate
          // the thread, which would make subsequent reply deletions fail.
          for (const c of [...thread.comments].reverse()) {
            await commentApi.deleteComment(threadId, c.id);
          }
        });
        /* v8 ignore next -- thread is dropped locally on success only */
        if (ok === null) return;
        dispatch({ type: "DELETE_THREAD", threadId });
        track(events.threadDeleted({ commentCount: thread.comments.length }));
        setActiveThreadId(clearIfEquals(threadId));
      })();
    },
    [threadState.threadsById, commentApi, persistWith],
  );

  const onToggleReaction = React.useCallback(
    (threadId: string, commentId: string, kind: ReactionKind) => {
      // Decide add vs remove before dispatch so persistence hits the right endpoint.
      const thread = threadState.threadsById[threadId];
      const comment = thread?.comments.find((c) => c.id === commentId);
      const hadIt =
        /* v8 ignore start -- optional-chain/nullish guards for a missing comment or reactions array */
        comment?.reactions?.some(
          (r) =>
            r.kind === kind && r.users.some((u) => u.id === currentUser.id),
        ) ?? false;
      /* v8 ignore stop */
      const add = !hadIt;
      void (async () => {
        const ok = await persistWith("Toggle reaction", () =>
          commentApi.toggleReaction(threadId, commentId, kind, add),
        );
        /* v8 ignore next -- optimistic update skipped when the remote write fails */
        if (ok === null) return;
        dispatch({
          type: "TOGGLE_REACTION",
          threadId,
          commentId,
          kind,
          userId: currentUser.id,
          displayName: currentUser.displayName,
        });
        track(events.commentReacted({ active: add, kind }));
      })();
    },
    [
      threadState.threadsById,
      commentApi,
      persistWith,
      currentUser.id,
      currentUser.displayName,
    ],
  );

  // -------------------------------------------------------------------------
  // Refs for components that need to measure the article
  // -------------------------------------------------------------------------
  const articleWrapRef = React.useRef<HTMLDivElement | null>(null);
  const bodyRef = React.useRef<HTMLDivElement | null>(null);

  // ArticleView renders the single `.emr-article-wrap`; read it from the DOM
  // after each render rather than threading a ref through.
  React.useLayoutEffect(() => {
    articleWrapRef.current = document.querySelector(".emr-article-wrap");
  }, [renderVersion, anchorLayout]);

  const orphanedSet = React.useMemo(
    () => new Set(anchorLayout.orphanedThreadIds),
    [anchorLayout],
  );
  const hiddenSet = React.useMemo(() => {
    const s = new Set<string>();
    // Search spans all statuses; otherwise the selected filter applies. The
    // same rule covers current-file, General, and orphaned-file sections.
    for (const t of currentThreadsRaw) {
      if (
        !threadVisibleForCommentView(
          t,
          commentQuery,
          commentFilter,
          currentUser.id,
        )
      )
        s.add(t.id);
    }
    for (const t of generalThreads) {
      if (
        !threadVisibleForCommentView(
          t,
          commentQuery,
          commentFilter,
          currentUser.id,
        )
      )
        s.add(t.id);
    }
    for (const t of orphanedFileThreads) {
      if (
        !threadVisibleForCommentView(
          t,
          commentQuery,
          commentFilter,
          currentUser.id,
        )
      )
        s.add(t.id);
    }
    return s;
  }, [
    currentThreadsRaw,
    generalThreads,
    orphanedFileThreads,
    commentQuery,
    commentFilter,
    currentUser.id,
  ]);

  const pristineHtml = htmlByPath[selectedPath] ?? "";
  const currentFileDiff = props.diffsByFile[selectedPath];
  const currentOriginalSource = props.originalSourcesByFile?.[selectedPath];
  // A file added or removed wholesale in the PR has no meaningful "what
  // changed" story — every line is the same colour — so we suppress the diff
  // layer and its toggle for those and just show the clean document.
  const currentFileChangeType = React.useMemo(
    () => pr.files.find((f) => f.path === selectedPath)?.changeType,
    [pr.files, selectedPath],
  );
  const isWholeFileChange =
    currentFileChangeType === "added" || currentFileChangeType === "deleted";
  // ---- comment-history stepper: active-stop render values ----
  // A historical stop swaps the whole document view atomically — content,
  // threads, routed-PR pill and read-only state all follow the active stop, so
  // the existing anchor/positioning pipeline simply re-resolves against the
  // historical snapshot.
  const historicalHtml = historicalContentKey
    ? historicalHtmlByKey[historicalContentKey]
    : undefined;
  // A historical stop with no recorded merge commit can't load a snapshot
  // (`historicalContentKey` is null), so fall back to the live head content
  // instead of rendering a blank, perpetually-"loading" article.
  const usingHistoricalContent = viewingHistorical && !!historicalContentKey;
  const historicalLoadError = historicalLoadTargets.reduce<string | undefined>(
    (found, target) => found ?? historicalErrorByKey[target.key],
    undefined,
  );
  // Comparing PR updates, the file may not exist at an endpoint. Absent at the
  // NEWER end: nothing to show (the PR adds it later / deleted it) — a notice
  // with a way back to "All updates". Absent at the OLDER end only: the file is
  // new within the selection, so it renders as wholly added (like "All
  // updates" shows a file the PR adds) rather than as a load error. A file the
  // PR deletes is absent at the latest update too, even though the live view
  // (which "All updates" uses) shows its pre-deletion content.
  const activeAbsent =
    (historicalContentKey != null &&
      !!historicalAbsentByKey[historicalContentKey]) ||
    (comparingIterations &&
      historicalContentKey == null &&
      currentFileChangeType === "deleted");
  const absentNotice = activeAbsent
    ? absentAtUpdateMessage(
        currentFileChangeType,
        resolvedIterationRange.range.toUpdate,
      )
    : null;
  const baselineAbsent =
    baselineContentKey != null && !!historicalAbsentByKey[baselineContentKey];
  const historicalLoading =
    historicalLoadError === undefined &&
    !activeAbsent &&
    ((usingHistoricalContent && historicalHtml === undefined) ||
      (baselineContentKey != null &&
        !baselineAbsent &&
        historicalSourceByKey[baselineContentKey] === undefined));
  const readerActivities = React.useMemo(
    () =>
      buildReaderActivities({
        navigationActivities,
        commentSyncing: threadSync.isRefreshing,
        fileRefreshing: fileRefreshInFlight,
        historicalLoading,
        documentLoading: loading,
      }),
    [
      navigationActivities,
      threadSync.isRefreshing,
      fileRefreshInFlight,
      historicalLoading,
      loading,
    ],
  );
  const activePristineHtml = usingHistoricalContent
    ? (historicalHtml ?? "")
    : pristineHtml;

  const articleHtml = useWikiSubpages({
    html: activePristineHtml,
    documentPath: selectedPath,
    historical: usingHistoricalContent,
    commitId: activeStop.commitId,
    listFolder: props.listFolder,
  });
  const activeStorageKey =
    viewingHistorical && historicalContentKey
      ? historicalContentKey
      : selectedPath;
  activeStorageKeyRef.current = activeStorageKey;

  // Cross-document `#anchor`: once the newly selected doc has rendered, scroll
  // to its heading (a same-doc anchor scrolls immediately in handleDocLink).
  // Also consumes the `?anchor=` deep link seeded at mount. "Rendered" means
  // the article actually shown — when a link opens an earlier PR update, that
  // is the earlier version, which loads after the latest one.
  const articleReady =
    !!activePristineHtml && !historicalLoading && !absentNotice;
  React.useEffect(() => {
    if (!articleReady) return;
    const text = pendingTextRef.current;
    if (text) {
      pendingTextRef.current = null;
      const fallback = pendingScrollHashRef.current;
      pendingScrollHashRef.current = null;
      pendingHashIsDeepLinkRef.current = false;
      scrollDocToText(text, (found) => {
        track(events.linkOpened({ target: "text", found }));
        if (!found && fallback) scrollDocToHash(fallback, { hold: true });
      });
      return;
    }
    const hash = pendingScrollHashRef.current;
    if (!hash) return;
    pendingScrollHashRef.current = null;
    const fromDeepLink = pendingHashIsDeepLinkRef.current;
    pendingHashIsDeepLinkRef.current = false;
    scrollDocToHash(hash, {
      hold: true,
      focus: !fromDeepLink,
      onResolved: fromDeepLink
        ? (found) => track(events.linkOpened({ target: "heading", found }))
        : undefined,
    });
  }, [
    selectedPath,
    articleReady,
    activePristineHtml,
    scrollDocToHash,
    scrollDocToText,
  ]);
  const activeDocumentImageResolver = React.useMemo(
    () =>
      bindRepositoryImageResolver(
        props.resolveDocumentImage,
        selectedPath,
        viewingHistorical ? activeStop.commitId : undefined,
      ),
    [
      props.resolveDocumentImage,
      selectedPath,
      viewingHistorical,
      activeStop.commitId,
    ],
  );
  const activeSource = usingHistoricalContent
    ? historicalSourceByKey[historicalContentKey!]
    : sourceByPath[selectedPath];
  const baselineSource = comparingIterations
    ? baselineAbsent
      ? ""
      : historicalSourceByKey[baselineContentKey!]
    : undefined;
  const iterationDiff = React.useMemo(
    () =>
      comparingIterations &&
      baselineSource !== undefined &&
      activeSource !== undefined
        ? sourceDiffRanges(baselineSource, activeSource)
        : undefined,
    [comparingIterations, baselineSource, activeSource],
  );
  const activeOriginalSource = comparingIterations
    ? baselineSource
    : currentOriginalSource;
  const activeDiffTarget = comparingIterations
    ? activeSource
    : sourceByPath[selectedPath];
  const rawActiveDiff = comparingIterations ? iterationDiff : currentFileDiff;
  // Both line diffs (ADO's and the update comparison's) report a rewrite as
  // coarse hunks; re-align them per Markdown block so new blocks read as
  // added and only genuine edits read as edited.
  const activeDiff = React.useMemo(
    () =>
      rawActiveDiff &&
      refineDiffRanges(rawActiveDiff, activeOriginalSource, activeDiffTarget),
    [rawActiveDiff, activeOriginalSource, activeDiffTarget],
  );
  const diffAvailable = comparingIterations
    ? !baselineAbsent && !!iterationDiff && iterationDiff.length > 0
    : !viewingHistorical &&
      !isWholeFileChange &&
      !!currentFileDiff &&
      currentFileDiff.length > 0;
  const showDiff = diffAvailable && !diffHidden;

  // Subtle word-count badge for the doc-nav title. Uses the active document's
  // Markdown source; falls back to 0 (badge hidden) until the source loads.
  const docWordCount = React.useMemo(
    () => countWords(activeSource ?? ""),
    [activeSource],
  );
  // When the diff is shown, also surface how the PR grew/shrank the prose:
  // words added vs. removed, derived from the changed line ranges. `showDiff`
  // already implies a present, non-empty `currentFileDiff` (see `diffAvailable`),
  // so the delta only needs the show/hide gate here; an all-zero delta is fine —
  // the badge simply renders no `+/−` segment.
  const docWordDelta = React.useMemo(() => {
    if (!showDiff) return undefined;
    return wordCountDelta(activeSource ?? "", activeDiff!);
  }, [showDiff, activeDiff, activeSource]);
  const viewingDeletedFile = currentFileChangeType === "deleted";
  const activeRoutedPr: RoutedPrInfo | undefined =
    viewingHistorical && !nativeIterationMode
      ? {
          /* v8 ignore start -- a historical stop always carries prId/title; the fallbacks are defensive */
          prId: activeStop.prId ?? 0,
          title: activeStop.title ?? `PR #${activeStop.prId}`,
          /* v8 ignore stop */
          status: "completed",
          url: activeStop.url,
        }
      : effectiveRoutedPr;
  const commentsAvailable =
    !props.documentsMode ||
    routedPrResolution === undefined ||
    activeRoutedPr?.status === "completed";
  commentsAvailableRef.current = commentsAvailable;
  // Comparing earlier updates of THIS PR stays writable: threads belong to
  // the PR, so replies/resolve/likes work anywhere, and a new comment is
  // checked against the latest version before its composer opens (see
  // `commentBlocker`). Only the Documents hub's history stops — earlier,
  // completed PRs — are read-only.
  const viewingPastPr = viewingHistorical && !nativeIterationMode;
  const activeReadOnly =
    effectiveReadOnly ||
    viewingPastPr ||
    viewingDeletedFile ||
    !commentsAvailable;
  const activeReadOnlyMessage = viewingPastPr
    ? `Viewing this document as it was at pull request #${activeStop.prId}. Comments here are read-only — open the pull request to reply.`
    : viewingDeletedFile
      ? "This document was deleted in this pull request. Its previous version is read-only."
      : !commentsAvailable
        ? "Comments are unavailable until this document is part of a completed pull request."
        : effectiveReadOnlyMessage;
  React.useLayoutEffect(() => {
    // Single-file panels keep their legacy shrink-and-scroll behaviour, so they
    // never disable the reader.
    if (props.hideDocNav) {
      setTooNarrow(false);
      return;
    }
    const frame = bodyFrameRef.current;
    /* v8 ignore next -- the ref is always attached by the time a layout effect runs */
    if (!frame) return;
    // Budget for the comment rail when it can be revealed. A document that has
    // explicitly resolved without a housing PR has no comments UI to reserve.
    const need = readerMinWidth(
      readerPrefs.showNav,
      commentsAvailable,
      readerPrefs.navWidthPct,
      readerPrefs.commentWidthPct,
    );
    const measure = (): void => setTooNarrow(frame.clientWidth < need);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [
    props.hideDocNav,
    commentsAvailable,
    readerPrefs.showNav,
    readerPrefs.navWidthPct,
    readerPrefs.commentWidthPct,
  ]);
  const historyNav =
    completedPrHistoryEnabled && historyStops.length > 1
      ? {
          canNewer: clampedStopIndex > 0,
          canOlder: clampedStopIndex < historyStops.length - 1,
          olderLabel: historyChevronTooltip(
            "older",
            historyStops[clampedStopIndex + 1],
          ),
          newerLabel: historyChevronTooltip(
            "newer",
            historyStops[clampedStopIndex - 1],
          ),
          onNewer: () => {
            setCompletedHistoryStopIndex(
              stepStopIndex(clampedStopIndex, -1, historyStops.length),
            );
            setActiveThreadId(null);
            dismissEmptyDraftRef.current();
          },
          onOlder: () => {
            setCompletedHistoryStopIndex(
              stepStopIndex(clampedStopIndex, 1, historyStops.length),
            );
            setActiveThreadId(null);
            dismissEmptyDraftRef.current();
          },
        }
      : undefined;
  const iterationOptions = React.useMemo<ReaderIterationOption[]>(
    () =>
      nativeIterationMode
        ? historyStops
            .map((stop, newestFirstIndex) => ({
              stopIndex: newestFirstIndex,
              number: historyStops.length - newestFirstIndex,
              title: stop.title!,
              dateMs: stop.dateMs,
            }))
            .reverse()
        : [],
    [historyStops, nativeIterationMode],
  );
  const changeIterationRange = React.useCallback(
    (range: ReviewIterationRange) => {
      setIterationRange(range);
      setActiveThreadId(null);
      dismissEmptyDraftRef.current();
    },
    [],
  );

  // Comparing up to an EARLIER update: comments still attach to the latest
  // version, so a selection can only be commented on if its text is still in
  // the latest version. Otherwise the selection bubble explains why and
  // offers to extend the comparison to the latest update (same start point).
  const latestHtml = htmlByPath[selectedPath];
  const comparisonStart = resolvedIterationRange.range.fromUpdate;
  const commentBlocker = React.useMemo(() => {
    if (!nativeIterationMode || !viewingHistorical || !latestHtml) {
      return undefined;
    }
    return (anchor: TextQuoteAnchor) =>
      relocateAnchor(anchor, latestHtml)
        ? null
        : {
            message:
              "This text changed in a later update, so a comment can't be attached to it.",
            actionLabel: `Compare up to Update ${nativeUpdateCount}`,
            onAction: () =>
              changeIterationRange({
                fromUpdate: comparisonStart,
                toUpdate: nativeUpdateCount,
              }),
          };
  }, [
    nativeIterationMode,
    viewingHistorical,
    latestHtml,
    nativeUpdateCount,
    comparisonStart,
    changeIterationRange,
  ]);

  // ---- Comment search ----
  // Search spans every rail section and status. Article highlights use the
  // same matching rule, so the prose and rail always show the same result set.
  const matchesQuery = React.useCallback(
    (t: CommentThread): boolean => threadMatchesQuery(t, commentQuery),
    [commentQuery],
  );
  const filteredCurrentThreads = React.useMemo(
    () => currentThreadsRaw.filter(matchesQuery),
    [currentThreadsRaw, matchesQuery],
  );
  const filteredGeneralThreads = React.useMemo(
    () => generalThreads.filter(matchesQuery),
    [generalThreads, matchesQuery],
  );
  const filteredOrphanedFileThreads = React.useMemo(
    () => orphanedFileThreads.filter(matchesQuery),
    [orphanedFileThreads, matchesQuery],
  );
  const commentCycleThreadIds = React.useMemo(
    () =>
      buildRailModel({
        currentThreads: filteredCurrentThreads,
        generalThreads: filteredGeneralThreads,
        orphanedFileThreads: filteredOrphanedFileThreads,
        hiddenThreadIds: hiddenSet,
        orphanedThreadIds: orphanedSet,
        yByThreadId: anchorLayout.yByThreadId,
        draftY:
          !activeReadOnly && activeDraft?.anchor && draftY !== null
            ? draftY
            : null,
        onlyThisFile,
      }).cycleThreadIds,
    [
      filteredCurrentThreads,
      filteredGeneralThreads,
      filteredOrphanedFileThreads,
      hiddenSet,
      orphanedSet,
      anchorLayout.yByThreadId,
      activeReadOnly,
      activeDraft?.anchor,
      draftY,
      onlyThisFile,
    ],
  );
  // Counts for the search summary line.
  const totalCommentCount = React.useMemo(() => {
    let n = 0;
    for (const t of [
      ...currentThreadsRaw,
      ...generalThreads,
      ...orphanedFileThreads,
    ]) {
      n += t.comments.length;
    }
    return n;
  }, [currentThreadsRaw, generalThreads, orphanedFileThreads]);

  // Number of current threads that are resolved/wontFix/closed. Drives the
  // rail header's "all resolved" celebration.
  const resolvedThreadCount = React.useMemo(() => {
    let n = 0;
    for (const t of currentThreadsRaw) {
      if (isResolvedLike(t.status)) n += 1;
    }
    return n;
  }, [currentThreadsRaw]);

  // Number of current threads still open (not resolved/wontFix/closed). When
  // this reaches zero on a file that had comments, the rail header celebrates.
  const openThreadCount = React.useMemo(() => {
    let n = 0;
    for (const t of currentThreadsRaw) {
      if (!isResolvedLike(t.status)) n += 1;
    }
    return n;
  }, [currentThreadsRaw]);

  // Live per-bucket counts backing the rail's comment filter menu, tallied
  // across every tray the rail surfaces (current file + General + orphaned).
  const filterCounts = React.useMemo<CommentFilterCounts>(
    () =>
      countCommentFilters(
        onlyThisFile
          ? currentThreadsRaw
          : [...currentThreadsRaw, ...generalThreads, ...orphanedFileThreads],
        currentUser.id,
      ),
    [
      onlyThisFile,
      currentThreadsRaw,
      generalThreads,
      orphanedFileThreads,
      currentUser.id,
    ],
  );

  // Global "show / hide changes" switch, rendered in the DocNav header so it
  // reads as a single preference over the whole document set rather than a
  // pill floating on one article. Gated on `diffAvailable` so it only appears
  // for the CURRENTLY-viewed file when that file actually has a displayable
  // edit diff — i.e. an *edited* file. A wholesale added/deleted file (every
  // line one colour), a historical snapshot, or a locally-edited buffer has no
  // meaningful diff to toggle, so the control is hidden rather than shown
  // inertly. (`diffAvailable` already folds in the added/deleted, historical,
  // and dirty-buffer rules.)
  //
  // Telemetry-wrapped UI toggles. The presentational children stay oblivious;
  // the container records the engagement action alongside the state change.
  const handleToggleDiff = React.useCallback(() => {
    // After the flip, the diff is visible iff it was hidden beforehand.
    const nowVisible = diffHidden;
    setDiffHidden((v) => !v);
    track(events.diffToggled({ visible: nowVisible }));
  }, [diffHidden]);

  const handleFilterModeChange = React.useCallback(
    (mode: CommentFilterMode) => {
      setCommentFilter(mode);
      track(events.commentFiltered({ mode, scoped: onlyThisFile }));
    },
    [onlyThisFile],
  );

  const handleOnlyThisFileChange = React.useCallback(
    (value: boolean) => {
      setOnlyThisFile(value);
      track(events.commentFiltered({ mode: commentFilter, scoped: value }));
    },
    [commentFilter],
  );

  // Effective panel visibility. Nav can't be toggled in single-file mode
  // (`hideDocNav` — there's no file tree) so it stays hidden there; comments
  // follow the reader's focus preference. The reading font + size scale reach
  // the article through CSS custom properties set on the app root.
  const navToggleable = !props.hideDocNav;
  const navHidden = props.hideDocNav || !readerPrefs.showNav;
  const commentsHidden = !commentsAvailable || !readerPrefs.showComments;
  const readerFont = resolveReaderFont(readerPrefs.fontId);
  const readerSpacing = readerSpacingValues(readerPrefs);
  const readerStyle = {
    "--emr-reader-font": readerFont.stack,
    "--emr-reader-scale": String(readerPrefs.sizePct / 100),
    "--emr-reader-line-height": String(readerSpacing.lineHeight),
    "--emr-reader-letter-spacing": `${readerSpacing.letterSpacingEm}em`,
    "--emr-reader-word-spacing": `${readerSpacing.wordSpacingEm}em`,
    "--emr-reader-paragraph-spacing": `${readerSpacing.paragraphSpacingPx}px`,
    "--emr-nav-scale": String(widthScale(readerPrefs.navWidthPct)),
    "--emr-rail-scale": String(widthScale(readerPrefs.commentWidthPct)),
  } as React.CSSProperties;
  const feedbackHref = props.feedbackEmail
    ? `mailto:${props.feedbackEmail}?subject=${encodeURIComponent(
        "Markdown Review — bug report / feedback",
      )}`
    : undefined;

  return (
    <IdentityStoreContext.Provider value={identityStore}>
      <CommentApiScope
        api={commentApi}
        busy={writesInFlight > 0}
        registerEditor={registerEditor}
      >
        <div
          className={`emr-app${navHidden ? " is-nav-hidden" : ""}${
            commentsHidden ? " is-comments-hidden" : ""
          }${props.documentsMode ? " is-documents-mode" : ""}${
            tooNarrow ? " is-too-narrow" : ""
          }`}
          style={readerStyle}
        >
          {persistError ? (
            <div className="emr-toast emr-toast--error" role="alert">
              <span className="emr-toast-icon" aria-hidden="true">
                ⚠
              </span>
              <span className="emr-toast-msg">{persistError}</span>
              <button
                type="button"
                className="emr-toast-dismiss"
                onClick={() => setPersistError(null)}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          ) : null}
          <SessionNotice reloadAllowed={openEditors === 0} />
          {missingDoc ? (
            <div className="emr-toast emr-toast--info" role="status">
              <span className="emr-toast-msg">
                <code>{missingDoc.missing}</code> is no longer in this
                repository &mdash; it may have been moved or deleted. Showing{" "}
                <code>{missingDoc.shown}</code> instead.
              </span>
              <button
                type="button"
                className="emr-toast-dismiss"
                onClick={() => setMissingDoc(null)}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          ) : null}
          {draftGuard ? (
            <DraftGuardDialog
              fileName={
                /* v8 ignore start -- pop() only yields undefined for an all-slash path */
                draftGuard.existingPath.split("/").filter(Boolean).pop() ??
                draftGuard.existingPath
                /* v8 ignore stop */
              }
              snippet={draftGuard.snippet}
              onDiscard={onDiscardExistingDraft}
              onKeepEditing={onKeepExistingDraft}
            />
          ) : null}

          <div
            ref={bodyFrameRef}
            className={`emr-body-frame${props.hideDocNav ? " emr-body-frame--no-nav" : ""}`}
          >
            {/* Navigation rail — fixed width, anchored to the viewport's left
                edge, its own scroller. Rendered whenever the nav is a feature
                (full page); focus mode hides it via `.is-nav-hidden` but keeps
                it MOUNTED so expand/scroll state survives toggling (the document
                reclaims the freed width). Single-file panels drop it entirely. */}
            {navToggleable ? (
              <div className="emr-body__nav">
                <DocNav
                  articleWrapRef={articleWrapRef}
                  scrollRef={bodyRef}
                  version={renderVersion}
                  files={pr.files}
                  selectedPath={selectedPath}
                  onSelectPath={selectDocPath}
                  threadCountsByPath={threadCountsByPath}
                  unloadedFolders={props.unloadedFolders}
                  onExpandFolder={props.onExpandFolder}
                  folderOrders={props.folderOrders}
                  wikiPages={props.documentsMode}
                  showOutline={readerPrefs.showOutline}
                  onSearchFiles={props.onSearchFiles}
                  titleSlot={props.docNavTitleSlot}
                  // Per-file A/M/D change indicators only make sense against a
                  // PR base. The Documents hub shows the latest master (no diff
                  // baseline — every file is just "present"), so it suppresses
                  // them.
                  showChangeIndicators={props.draftScope !== "hub"}
                  rangeChanges={docNavRangeChanges}
                  onActivitiesChange={setNavigationActivities}
                />
                {/* Resize affordance on the rail's right border: drag to set
                    the nav width, double-click to reset. Mouse enhancement
                    (hidden from AT) — the toolbar's Navigation-width stepper is
                    the keyboard-accessible equivalent. */}
                <div
                  className="emr-nav-resize"
                  title="Drag to resize navigation (double-click to reset)"
                  aria-hidden="true"
                  onPointerDown={onNavResizeStart}
                  onPointerMove={onNavResizeMove}
                  onPointerUp={onNavResizeEnd}
                  onPointerCancel={onNavResizeEnd}
                  onDoubleClick={resetNavWidth}
                />
              </div>
            ) : null}
            <div className="emr-body" ref={bodyRef}>
              {/* Document overview scrollbar — the ONLY custom bar in the
                  reader. Lives INSIDE the document (a sticky, zero-height anchor
                  pinned to the scroll viewport's top), hugging the document's
                  RIGHT edge, so the comment rail can sit flush against the
                  document and its resize handle aligns with the document's right
                  edge (mirroring the nav handle on the left). Charts every
                  change in THIS file (green add / amber edit / red delete) as a
                  draggable thumb; maps ONLY the document scroll (bodyRef). */}
              <div className="emr-diff-scrollbar-anchor" aria-hidden="true">
                <DiffMinimap
                  scrollRef={bodyRef}
                  version={renderVersion}
                  showDiff={showDiff}
                />
              </div>
              {/*
            The article column. Per-file loading + render errors are scoped
            here (and the comment rail) so switching files never blanks the
            whole shell — only the middle + rail swap to a subtle skeleton
            while the next file streams in. The nav rail is a left sibling.
          */}
              <div
                className={`emr-grid${props.hideDocNav ? " emr-grid--no-nav" : ""}`}
              >
                {error ? (
                  <div className="emr-article-wrap">
                    <div className="emr-error">
                      <h2>Couldn&rsquo;t open this document</h2>
                      <p>
                        <code>{selectedPath}</code> couldn&rsquo;t be loaded. It
                        may have been moved or deleted, or you may not have
                        access to it. Pick another document from the navigation.
                      </p>
                      <pre>{error}</pre>
                    </div>
                  </div>
                ) : loading && !pristineHtml ? (
                  <ArticleSkeleton />
                ) : absentNotice ? (
                  <div className="emr-article-wrap">
                    <div className="emr-update-absent" role="status">
                      <h2>{absentNotice.title}</h2>
                      <p>
                        <code>{selectedPath}</code>: {absentNotice.body}
                      </p>
                      <button
                        type="button"
                        className="emr-update-absent-action"
                        onClick={() =>
                          changeIterationRange(
                            allReviewIterations(nativeUpdateCount),
                          )
                        }
                      >
                        Show all updates
                      </button>
                    </div>
                  </div>
                ) : historicalLoadError ? (
                  <div className="emr-article-wrap">
                    <div className="emr-error">
                      <h2>Couldn&rsquo;t load this version</h2>
                      <p>
                        <code>{selectedPath}</code> couldn&rsquo;t be loaded at
                        the selected revision. It may not exist at that commit,
                        or you may not have access to it.
                      </p>
                      <pre>{historicalLoadError}</pre>
                    </div>
                  </div>
                ) : historicalLoading ? (
                  <ArticleSkeleton />
                ) : (
                  <ArticleView
                    pristineHtml={articleHtml}
                    documentPath={selectedPath}
                    readerFontFamily={readerFont.stack}
                    threads={visibleForArticle}
                    activeThreadId={activeThreadId}
                    draftAnchor={draftAnchor}
                    storageKey={activeStorageKey}
                    onAnchorsResolved={onAnchorsResolved}
                    onHighlightClick={onHighlightClick}
                    onSelection={onSelectionMade}
                    readOnly={activeReadOnly}
                    diff={activeDiff}
                    originalSource={activeOriginalSource}
                    currentSource={activeSource}
                    showDiff={showDiff}
                    onDocLink={handleDocLink}
                    resolveDocumentImage={activeDocumentImageResolver}
                    onCopyHeadingLink={
                      viewingPastPr ? undefined : onCopyHeadingLink
                    }
                    onCopySelectionLink={
                      viewingPastPr ? undefined : onCopySelectionLink
                    }
                    commentBlocker={commentBlocker}
                  />
                )}
              </div>
            </div>

            {/* Comment rail — a SEPARATE scroll container (a flex sibling of
                `.emr-body`, not nested in it), so scrolling the article to its
                end never chain-scrolls the comments. It carries a native
                scrollbar (styled to match the reader) on its far-right edge.
                The wrapper stays mounted while the skeleton/list swaps inside,
                so the rail's scroll position survives the load. Its own
                left-border handle (full reader only) drag-resizes it live,
                INDEPENDENTLY of the nav. */}
            <div className="emr-rail">
              <div className="emr-rail-scroll">
                {(loading && !pristineHtml) || historicalLoading ? (
                  <RailSkeleton />
                ) : (
                  <CommentRail
                    currentThreads={filteredCurrentThreads}
                    generalThreads={filteredGeneralThreads}
                    orphanedFileThreads={filteredOrphanedFileThreads}
                    orphanedThreadIds={orphanedSet}
                    hiddenThreadIds={hiddenSet}
                    yByThreadId={anchorLayout.yByThreadId}
                    draftAnchor={draftAnchor}
                    draftY={draftY}
                    activeThreadId={activeThreadId}
                    currentUser={currentUser}
                    onSelectThread={onSelectThread}
                    onReply={onReply}
                    onResolve={onResolve}
                    onReopen={onReopen}
                    onMarkPending={onMarkPending}
                    onClose={onCloseThread}
                    onEditComment={onEditComment}
                    onDeleteComment={onDeleteComment}
                    onDeleteThread={onDeleteThread}
                    onToggleReaction={onToggleReaction}
                    onSubmitDraft={onSubmitDraft}
                    onCancelDraft={onCancelDraft}
                    draftInitialBody={draft.initialBody}
                    onDraftChange={draft.handleChange}
                    activeReplyThreadId={activeReplyThreadId}
                    replyInitialBody={draft.initialBody}
                    onRequestReply={onRequestReply}
                    onCancelReply={onCancelReply}
                    commentQuery={commentQuery}
                    onCommentQueryChange={setCommentQuery}
                    totalCommentCount={totalCommentCount}
                    resolvedThreadCount={resolvedThreadCount}
                    openThreadCount={openThreadCount}
                    filterCounts={filterCounts}
                    filterMode={commentFilter}
                    onFilterModeChange={handleFilterModeChange}
                    onAddComment={onAddImplicitComment}
                    onlyThisFile={onlyThisFile}
                    onOnlyThisFileChange={handleOnlyThisFileChange}
                    readOnly={activeReadOnly}
                    readOnlyMessage={activeReadOnlyMessage}
                    showReadOnlyBanner={
                      !nativeIterationMode || !viewingHistorical
                    }
                    routedPr={activeRoutedPr}
                    hidePrPill={
                      hidePrPill ||
                      props.documentsMode ||
                      (nativeIterationMode && viewingHistorical)
                    }
                    historyNav={historyNav}
                  />
                )}
              </div>
              {/* Drag the rail's LEFT border to resize the comments live;
                  double-click resets. Mouse-only enhancement (aria-hidden),
                  mirroring the nav handle — full reader only (single-file panels
                  keep a fixed rail). */}
              {navToggleable && commentsAvailable ? (
                <div
                  className="emr-rail-resize"
                  title="Drag to resize comments (double-click to reset)"
                  aria-hidden="true"
                  onPointerDown={onCommentResizeStart}
                  onPointerMove={onCommentResizeMove}
                  onPointerUp={onCommentResizeEnd}
                  onPointerCancel={onCommentResizeEnd}
                  onDoubleClick={resetCommentWidth}
                />
              ) : null}
            </div>

            {/* Edge grabbers to REOPEN a collapsed pane by dragging inward — the
                drag counterpart to the status-bar toggles. Only mounted while a
                pane is hidden (full reader), pinned to the frame's edge. */}
            {navToggleable && navHidden ? (
              <div
                className="emr-nav-reopen"
                title="Drag to reopen navigation"
                aria-hidden="true"
                onPointerDown={onNavReopenStart}
                onPointerMove={onNavReopenMove}
                onPointerUp={onNavReopenEnd}
                onPointerCancel={onNavReopenEnd}
              />
            ) : null}
            {navToggleable && commentsAvailable && commentsHidden ? (
              <div
                className="emr-rail-reopen"
                title="Drag to reopen comments"
                aria-hidden="true"
                onPointerDown={onCommentReopenStart}
                onPointerMove={onCommentReopenMove}
                onPointerUp={onCommentReopenEnd}
                onPointerCancel={onCommentReopenEnd}
              />
            ) : null}

            {/* Graceful degradation notice — hidden until `.is-too-narrow`
                (set by the frame ResizeObserver), when it replaces the reader
                columns so the layout never crushes the prose. */}
            <div className="emr-too-narrow" role="status">
              <div className="emr-too-narrow-card">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M9 8 5 12l4 4M15 8l4 4-4 4M5 12h14" />
                </svg>
                <h3>More room needed</h3>
                <p>
                  There isn&rsquo;t enough width to show the document
                  comfortably. Widen the window to keep reading.
                </p>
              </div>
            </div>
          </div>
          {/* Reading status bar — the reader's single docked control surface
              (Word's status-bar model): document status on the left, the
              Navigation / Comments / Changes toggles, reading font, text size,
              refresh and feedback on the right. Full reader width; hidden by CSS
              when the reader is too narrow. */}
          <ReaderStatusBar
            wordCount={docWordCount}
            wordDelta={docWordDelta}
            resolvedPullRequest={
              props.documentsMode && activeRoutedPr?.status === "completed"
                ? activeRoutedPr
                : undefined
            }
            fontId={readerPrefs.fontId}
            sizePct={readerPrefs.sizePct}
            spacingPct={readerPrefs.lineSpacingPct}
            onFontChange={setReaderFont}
            onSizeChange={setReaderSize}
            onSpacingChange={setReaderSpacing}
            showNav={readerPrefs.showNav}
            onToggleNav={toggleReaderNav}
            showOutline={readerPrefs.showOutline}
            onToggleOutline={toggleReaderOutline}
            navToggleable={navToggleable}
            showComments={readerPrefs.showComments}
            commentsAvailable={commentsAvailable}
            onToggleComments={toggleReaderComments}
            commentThreadIds={commentCycleThreadIds}
            activeCommentThreadId={activeThreadId}
            onCycleComment={onCycleToThread}
            changesAvailable={diffAvailable}
            changesShown={!diffHidden}
            onToggleChanges={handleToggleDiff}
            iterationOptions={
              nativeIterationMode && iterationOptions.length > 1
                ? iterationOptions
                : undefined
            }
            iterationBaseCommit={
              nativeIterationMode ? props.reviewIterationBaseCommit : undefined
            }
            iterationRange={iterationRange}
            onIterationRangeChange={changeIterationRange}
            feedbackHref={feedbackHref}
            onRefresh={canRefreshComments ? handleRefresh : undefined}
            refreshing={threadSync.isRefreshing || fileRefreshInFlight}
            refreshLabel={refreshLabel}
            activities={readerActivities}
          />
        </div>
      </CommentApiScope>
    </IdentityStoreContext.Provider>
  );
}

// A subtle placeholder shown in the article column while the next file's
// source is fetched and rendered. Mirrors the article's max-width/gutter so
// the layout doesn't shift when the real content arrives. Shimmer is purely
// decorative and disabled under `prefers-reduced-motion` (see styles.scss).
function ArticleSkeleton(): React.ReactElement {
  return (
    <div className="emr-article-wrap emr-skeleton" aria-hidden="true">
      <div className="emr-skel-line emr-skel-title" />
      <div className="emr-skel-line emr-skel-w90" />
      <div className="emr-skel-line emr-skel-w75" />
      <div className="emr-skel-line emr-skel-w85" />
      <div className="emr-skel-block" />
      <div className="emr-skel-line emr-skel-w80" />
      <div className="emr-skel-line emr-skel-w60" />
      <div className="emr-skel-line emr-skel-w70" />
    </div>
  );
}

// Matching placeholder for the comment rail so the right column keeps its
// width (no reflow of the article) while threads for the new file resolve.
function RailSkeleton(): React.ReactElement {
  return (
    <aside className="emr-rail-col emr-skeleton" aria-hidden="true">
      <div className="emr-rail-header emr-skel-header" aria-hidden="true">
        <div className="emr-rail-toolbar">
          <div className="emr-skel-header-label emr-skel-w50" />
        </div>
      </div>
      <div className="emr-rail-skel-card" />
      <div className="emr-rail-skel-card" />
    </aside>
  );
}

/**
 * The comment API plus the "a write is in flight" flag every Composer reads
 * (see ComposerBusyContext), provided together at one tree level.
 */
function CommentApiScope({
  api,
  busy,
  registerEditor,
  children,
}: {
  api: CommentApi;
  busy: boolean;
  registerEditor: () => () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <CommentApiProvider value={api}>
      <ComposerBusyContext.Provider value={busy}>
        <RegisterEditorContext.Provider value={registerEditor}>
          {children}
        </RegisterEditorContext.Provider>
      </ComposerBusyContext.Provider>
    </CommentApiProvider>
  );
}
