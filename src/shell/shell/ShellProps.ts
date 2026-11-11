// Shell's props: everything the shell's hosts (the PR tab, the Documents
// hub, the side panel and the standalone preview) pass in.

import type { ReactNode } from "react";

import type {
    ChangeType,
    CommentAuthor,
    CommentThread,
    DiffRange,
    FileInfo,
    PrInfo,
} from "../../types";
import type { CommentApi } from "../../comments/api";
import type { DocumentImageResolver } from "../../markdown/documentImages";
import type { FileSearchOutcome } from "../almSearch";
import type { DraftScope } from "../draftStorage";
import type { DocPrRef, HistoryStop, ReviewIterationRange } from "../shellHelpers";
import type { FolderLister } from "../wikiOrder";
import type { DocLinkNavigation, RoutedPrInfo } from "./types";

export interface ShellProps {
    pr: PrInfo;
    /**
     * Async loader for the Markdown source of a given file path. When the
     * file was listed with its git blob (`FileInfo.objectId`), that id is
     * passed too: read exactly that blob, since the result is cached under it
     * in this browser (see `documentCache.ts`).
     */
    loadFileSource: (path: string, objectId?: string) => Promise<string>;
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
    /** Folders already listed with nothing to show; forwarded to DocNav. */
    emptyFolders?: ReadonlyArray<string>;
    /** Lazy folder expansion; undefined when every file is already loaded. */
    onExpandFolder?: (path: string) => Promise<{ files: FileInfo[]; folders: string[] } | null>;
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
    onSearchFiles?: (query: string, signal?: AbortSignal) => Promise<FileSearchOutcome>;
    /** Replaces the static "Documents" title in the doc-nav header. */
    docNavTitleSlot?: ReactNode;
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
