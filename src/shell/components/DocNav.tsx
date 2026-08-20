// Document navigation rail — a single left rail that combines:
//   - File switcher: each PR file is a top-level node with change kind, diff
//     stats, and an open-comment badge.
//   - Per-file table of contents: the selected file's heading tree (up to H4)
//     with scroll-spy and per-branch collapse chevrons.
//   - File finder: a header search box runs an instant local substring filter
//     plus (when `onSearchFiles` is wired) a debounced ADO Code Search; hits
//     are merged, deduped, and shown as a flat list.
//   - Lazy folder loading: folders surfaced via `unloadedFolders` are fetched
//     through `onExpandFolder` when the user expands them.
//
// Single-selection: exactly one node is active. A heading owns the highlight
// when scrolled into its section; otherwise the file row does. Heading-branch
// chevrons mirror the doc `<section>` collapse state; file-row chevrons are
// nav-only (they fold the TOC without touching the doc).

import * as React from "react";

import type { ChangeType, FileInfo } from "../../types";
import type { FileSearchOutcome } from "../almSearch";
import {
  buildFolderTree,
  normalizeFolderPath,
  type DirNode,
  type FileNode,
  type TreeNode,
} from "./folderTree";
import {
  buildFolderStorageKey,
  persistSectionState,
  readCollapsedDirs,
  writeCollapsedDirs,
} from "./navStorage";
import { useDocSearch } from "./useDocSearch";

interface DocNavProps {
  articleWrapRef: React.RefObject<HTMLDivElement | null>;
  scrollRef: React.RefObject<HTMLElement | null>;
  /** Bumped on article HTML change so we recompute. */
  version: number;
  /** Every file in the PR — drives the top-level nodes. */
  files: FileInfo[];
  /** The file currently loaded into the article view. */
  selectedPath: string;
  /** Switch to another file. */
  onSelectPath: (path: string) => void;
  /** Per-file count of unresolved current threads (drives the badge). */
  threadCountsByPath: Record<string, number>;
  /**
   * Folder paths the host has discovered but not enumerated. Each is rendered
   * as an expandable row; opening one calls `onExpandFolder`. Empty/undefined
   * in fully-loaded contexts (e.g. the standalone preview).
   */
  unloadedFolders?: ReadonlyArray<string>;
  /**
   * Lazy expansion callback, called once per folder the first time it opens.
   * The host merges the returned files + subfolders into the tree. Resolves
   * with `null` on error so the DocNav can show an inline retry.
   */
  onExpandFolder?: (
    path: string,
  ) => Promise<{ files: FileInfo[]; folders: string[] } | null>;
  /**
   * Remote filename search (ALM Code Search). Debounced inside the DocNav.
   * Resolves with a `FileSearchOutcome` so we can distinguish "0 results" from
   * "unavailable". An `AbortSignal` is passed for in-flight cancellation. Pass
   * `undefined` to use only the local filter.
   */
  onSearchFiles?: (
    query: string,
    signal?: AbortSignal,
  ) => Promise<FileSearchOutcome>;
  /**
   * Optional replacement for the static "Documents" rail title. The Documents
   * hub uses this to render an inline repo picker.
   */
  titleSlot?: React.ReactNode;
  /**
   * Optional extra header controls next to the search button (e.g. the
   * Documents hub's "refresh repo" button).
   */
  headerActions?: React.ReactNode;
  /**
   * Whether to show per-file change-type indicators (the A/M/D glyph) on file
   * rows. True in a PR context, where files carry real change semantics
   * against the PR base. The Documents hub shows the
   * latest master with no diff baseline — every file is simply "present", not
   * added/modified/deleted — so it passes `false` to suppress the misleading
   * indicators. Defaults to `true` (PR-like) when omitted.
   */
  showChangeIndicators?: boolean;
}

/**
 * Whether file rows should render change-type indicators. Provided by DocNav so
 * the deeply-nested `FileNavRow` / `SearchResultsList` renderers can read it
 * without drilling the flag through the recursive `NavTreeItem` tree. Defaults
 * to `true` so any renderer used outside a Provider keeps the PR-tab behaviour.
 */
const ChangeIndicatorContext = React.createContext<boolean>(true);

interface NavHeading {
  id: string;
  text: string;
  level: number;
  topPx: number;
  /** Number of unresolved threads anchored inside this heading's section. */
  openComments: number;
  /** Total number of threads (any status) anchored inside this section. */
  totalComments: number;
}

/** A node in the rendered tree: the folder/file tree plus the heading sub-tree
 *  under the selected file, with a "lazy-dir" kind for unenumerated folders. */
type NavNode =
  | {
      kind: "dir";
      path: string;
      displayName: string;
      children: NavNode[];
      /** True when the folder is unenumerated; chevron triggers a fetch. */
      lazy?: boolean;
    }
  | {
      kind: "file";
      file: FileInfo;
      openComments: number;
      children: NavNode[];
    }
  | { kind: "heading"; heading: NavHeading; children: NavNode[] };

const ACTIVE_MARGIN = 24; // px from top before a heading is "active"
const MAX_TREE_LEVEL = 4; // headings deeper than H4 are not shown in the nav

export function DocNav(props: DocNavProps): React.ReactElement | null {
  const {
    articleWrapRef,
    scrollRef,
    version,
    files,
    selectedPath,
    onSelectPath,
    threadCountsByPath,
    unloadedFolders,
    onExpandFolder,
    onSearchFiles,
    titleSlot,
    headerActions,
    showChangeIndicators = true,
  } = props;

  // The selected file is also our `storageKey` for per-section persistence
  // (collapsed sections are remembered per file).
  const storageKey = selectedPath;

  // Captured headings (id, text, level, top position).
  const [headings, setHeadings] = React.useState<NavHeading[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  // Section ids whose doc section is currently collapsed. Drives both the
  // chevron orientation in the nav AND whether to render descendant items.
  const [collapsedIds, setCollapsedIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  // Folder paths the user manually collapsed in the file tree (default: all
  // expanded). Persisted per-paths-signature in sessionStorage.
  const folderStorageKey = React.useMemo(
    () => buildFolderStorageKey(files),
    [files],
  );
  const [collapsedDirs, setCollapsedDirs] = React.useState<Set<string>>(() =>
    readCollapsedDirs(folderStorageKey),
  );
  // Reset folder collapse state whenever the file list changes shape.
  React.useEffect(() => {
    setCollapsedDirs(readCollapsedDirs(folderStorageKey));
  }, [folderStorageKey]);

  // -----------------------------------------------------------------------
  // Lazy folder expansion. Holds the set of folder paths whose fetch is
  // currently in flight so the row can show a spinner and we don't
  // double-fire on rapid clicks. The actual file/folder data flows in
  // via the next props update from the host.
  // -----------------------------------------------------------------------
  // The set of unloaded folder paths, canonicalized to the same slash-free
  // form `buildFolderTree` produces for each dir node's `path`. ADO seeds
  // `unloadedFolders` with leading-slash paths (`/docs`); without this
  // normalization `lazyDirSet.has(dirNode.path)` would miss and the folder
  // would render as a non-expandable empty row.
  const lazyDirSet = React.useMemo(
    () => new Set<string>((unloadedFolders ?? []).map(normalizeFolderPath)),
    [unloadedFolders],
  );
  const [loadingDirs, setLoadingDirs] = React.useState<Set<string>>(
    () => new Set(),
  );
  const inFlightDirsRef = React.useRef<Set<string>>(new Set());

  const expandLazyDir = React.useCallback(
    (dirPath: string) => {
      if (!onExpandFolder) return;
      /* v8 ignore next -- the row's buttons are disabled while a fetch is in
         flight, so this re-entrancy guard is unreachable via the UI */
      if (inFlightDirsRef.current.has(dirPath)) return;
      inFlightDirsRef.current.add(dirPath);
      setLoadingDirs((curr) => {
        const next = new Set(curr);
        next.add(dirPath);
        return next;
      });
      void (async () => {
        try {
          await onExpandFolder(dirPath);
        } finally {
          inFlightDirsRef.current.delete(dirPath);
          setLoadingDirs((curr) => {
            /* v8 ignore next -- defensive: the dir is always present in the
               loading set when its fetch settles */
            if (!curr.has(dirPath)) return curr;
            const next = new Set(curr);
            next.delete(dirPath);
            return next;
          });
        }
      })();
    },
    [onExpandFolder],
  );

  // File search: an instant local substring pass plus a debounced, cancellable
  // remote ADO Code Search. See useDocSearch for the merge/dedupe details.
  const {
    searchQuery,
    setSearchQuery,
    trimmedQuery,
    isSearching,
    searchOpen,
    setSearchOpen,
    closeSearch,
    searchInputRef,
    remoteLoading,
    searchUnavailable,
    searchResults,
  } = useDocSearch(files, onSearchFiles);

  // After a manual click we suppress scroll-spy briefly so the smooth
  // scroll animation doesn't keep flipping `activeId` until it lands.
  const spyLockUntilRef = React.useRef<number>(0);

  // Ref to the list container so we can auto-scroll the active item into
  // view (long docs would otherwise hide it behind the rail's overflow).
  const listRef = React.useRef<HTMLElement | null>(null);

  // -----------------------------------------------------------------------
  // Read the heading list out of the rendered DOM on each article re-render
  // (the rehype plugin tags each heading with a stable `id`), tallying
  // unresolved + total thread counts per section for the badge. Also
  // re-triggered by `emr-sections-changed` so resolving a comment refreshes
  // counts without bumping `version`.
  // -----------------------------------------------------------------------
  const readHeadings = React.useCallback(() => {
    const wrap = articleWrapRef.current;
    if (!wrap) {
      setHeadings([]);
      setCollapsedIds(new Set());
      return;
    }
    const hs = Array.from(wrap.querySelectorAll<HTMLElement>("h1, h2, h3, h4"));
    const wrapRect = wrap.getBoundingClientRect();
    const next: NavHeading[] = hs
      .map<NavHeading | null>((h) => {
        if (!h.id) return null;
        const section = h.parentElement as HTMLElement | null;
        let openComments = 0;
        let totalComments = 0;
        if (section?.classList.contains("emr-section")) {
          const highlights = section.querySelectorAll<HTMLElement>(
            ".emr-highlight[data-thread-id]",
          );
          const seen = new Set<string>();
          highlights.forEach((el) => {
            const tid = el.dataset.threadId;
            if (!tid || tid === "__draft__" || seen.has(tid)) return;
            seen.add(tid);
            totalComments += 1;
            if (!el.classList.contains("is-resolved")) openComments += 1;
          });
        }
        return {
          id: h.id,
          /* v8 ignore next -- heading elements always expose string textContent, never null */
          text: h.textContent ?? "",
          level: Number(h.tagName.substring(1)),
          topPx: h.getBoundingClientRect().top - wrapRect.top,
          openComments,
          totalComments,
        };
      })
      .filter((h): h is NavHeading => h !== null);
    setHeadings(next);

    // Also snapshot which sections are currently collapsed so the chevrons
    // and tree-pruning render correctly.
    const collapsed = new Set<string>();
    wrap
      .querySelectorAll<HTMLElement>('.emr-section[data-collapsed="true"]')
      .forEach((s) => {
        const sid = s.dataset.sectionId;
        if (sid) collapsed.add(sid);
      });
    setCollapsedIds(collapsed);
  }, [articleWrapRef]);

  React.useLayoutEffect(() => {
    // Initial read covers the case where the wrap pass already completed
    // before our listener attached.
    readHeadings();

    const wrap = articleWrapRef.current;
    if (!wrap) return;
    // Refresh on ArticleView's layout-changed signal. `useLayoutEffect` so we
    // attach before ArticleView's sibling effect fires its initial dispatch.
    function onChanged() {
      readHeadings();
    }
    wrap.addEventListener("emr-sections-changed", onChanged);
    return () => wrap.removeEventListener("emr-sections-changed", onChanged);
  }, [version, readHeadings, articleWrapRef]);

  // -----------------------------------------------------------------------
  // Scroll-spy: find the last heading whose top has scrolled past a small
  // margin from the viewport top. Listens on the body scroller.
  // -----------------------------------------------------------------------
  React.useEffect(() => {
    const scroller = scrollRef.current;
    const wrap = articleWrapRef.current;
    if (!scroller || !wrap || headings.length === 0) return;

    function recompute() {
      if (performance.now() < spyLockUntilRef.current) return;
      // When the user is at (or very near) the top of the article we want
      // the file row to own the "active" indicator — the single-selection
      // model means heading rows only light up once the user has scrolled
      // past the first heading.
      if (scroller!.scrollTop < ACTIVE_MARGIN) {
        setActiveId(null);
        return;
      }
      const wrapRectNow = wrap!.getBoundingClientRect();
      const scrollerRect = scroller!.getBoundingClientRect();
      const wrapTopRel =
        wrapRectNow.top - scrollerRect.top + scroller!.scrollTop;
      const cursor = scroller!.scrollTop + ACTIVE_MARGIN;
      let bestId: string | null = headings[0]!.id;
      for (const h of headings) {
        if (wrapTopRel + h.topPx <= cursor) bestId = h.id;
        else break;
      }
      setActiveId(bestId);
    }

    recompute();
    scroller.addEventListener("scroll", recompute, { passive: true });
    return () => scroller.removeEventListener("scroll", recompute);
  }, [headings, scrollRef, articleWrapRef]);

  // -----------------------------------------------------------------------
  // Keep the active nav item visible inside the rail's scroll container.
  // -----------------------------------------------------------------------
  React.useEffect(() => {
    if (!open || !activeId) return;
    const list = listRef.current!;
    const item = list.querySelector<HTMLElement>(
      `[data-nav-id="${cssEscape(activeId)}"]`,
    );
    /* v8 ignore next -- the active heading always has a rendered nav row */
    if (!item) return;
    const itemRect = item.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    const margin = 16;
    /* v8 ignore start -- scroll-into-view geometry; the headless rail layout reproduces neither branch */
    if (itemRect.top < listRect.top + margin) {
      list.scrollTop -= listRect.top + margin - itemRect.top;
    } else if (itemRect.bottom > listRect.bottom - margin) {
      list.scrollTop += itemRect.bottom - (listRect.bottom - margin);
    }
    /* v8 ignore stop */
  }, [activeId, open]);

  // -----------------------------------------------------------------------
  // Smooth-scroll to a heading on click.
  // -----------------------------------------------------------------------
  const scrollTo = React.useCallback(
    (id: string) => {
      const scroller = scrollRef.current!;
      const wrap = articleWrapRef.current!;
      const target = wrap.querySelector<HTMLElement>(
        `[id="${cssEscape(id)}"]`,
      )!;
      // Expand the target's collapsed section first so the scroll lands
      // somewhere visible.
      const section = target.closest<HTMLElement>(".emr-section");
      if (section?.getAttribute("data-collapsed") === "true") {
        section.removeAttribute("data-collapsed");
        // Persist so a later "expand all" / refresh doesn't re-collapse it.
        persistSectionState(storageKey, id, false);
        // Re-measure so balloons settle to their new (visible) Y.
        wrap.dispatchEvent(
          new CustomEvent("emr-sections-changed", { bubbles: false }),
        );
      }
      const wrapTopRel =
        wrap.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      const headingTopRel =
        target.getBoundingClientRect().top - wrap.getBoundingClientRect().top;
      // Lock the scroll-spy briefly so it doesn't fight the smooth scroll
      // and keep highlighting intermediate headings.
      spyLockUntilRef.current = performance.now() + 700;
      setActiveId(id);
      scroller.scrollTo({
        top: wrapTopRel + headingTopRel - 24,
        behavior: "smooth",
      });
    },
    [articleWrapRef, scrollRef, storageKey],
  );

  // -----------------------------------------------------------------------
  // Toggle a single section's collapsed state, mirroring the doc section so
  // nav-collapse and doc-collapse stay in lockstep.
  // -----------------------------------------------------------------------
  const toggleSection = React.useCallback(
    (id: string) => {
      const wrap = articleWrapRef.current!;
      const section = wrap.querySelector<HTMLElement>(
        `.emr-section[data-section-id="${cssEscape(id)}"]`,
      )!;
      const wasCollapsed = section.getAttribute("data-collapsed") === "true";
      if (wasCollapsed) section.removeAttribute("data-collapsed");
      else section.setAttribute("data-collapsed", "true");
      persistSectionState(storageKey, id, !wasCollapsed);
      wrap.dispatchEvent(
        new CustomEvent("emr-sections-changed", { bubbles: false }),
      );
    },
    [articleWrapRef, storageKey],
  );

  // -----------------------------------------------------------------------
  // Build a nested tree from the flat heading list: each heading nests under
  // the nearest preceding heading with a strictly lower level.
  // -----------------------------------------------------------------------
  const headingTree = React.useMemo<NavNode[]>(() => {
    const filtered = headings.filter((h) => h.level <= MAX_TREE_LEVEL);
    const roots: NavNode[] = [];
    const stack: Array<{ heading: NavHeading; children: NavNode[] }> = [];
    for (const h of filtered) {
      const node: NavNode = { kind: "heading", heading: h, children: [] };
      while (
        stack.length > 0 &&
        stack[stack.length - 1]!.heading.level >= h.level
      ) {
        stack.pop();
      }
      if (stack.length === 0) roots.push(node);
      else stack[stack.length - 1]!.children.push(node);
      stack.push({ heading: h, children: node.children });
    }
    return roots;
  }, [headings]);

  // -----------------------------------------------------------------------
  // Wrap the heading tree under the selected file node. Build a sorted
  // folder/file tree from `files`, then decorate each file with its
  // open-comment count and (for the selected file) the heading tree.
  // -----------------------------------------------------------------------
  const tree = React.useMemo<NavNode[]>(() => {
    const folderTree = buildFolderTree<FileInfo>(files, {
      extraFolders: unloadedFolders,
    });
    function toNavNode(node: TreeNode<FileInfo>): NavNode {
      if (node.kind === "dir") {
        const dirNode = node as DirNode<FileInfo>;
        // "Lazy" iff the path is unloaded AND has no fetched children yet.
        const isLazy =
          dirNode.children.length === 0 && lazyDirSet.has(dirNode.path);
        return {
          kind: "dir",
          path: dirNode.path,
          displayName: dirNode.displayName,
          children: dirNode.children.map(toNavNode),
          lazy: isLazy,
        };
      }
      const fileNode = node as FileNode<FileInfo>;
      return {
        kind: "file",
        file: fileNode.file,
        openComments: threadCountsByPath[fileNode.file.path] ?? 0,
        children: fileNode.file.path === selectedPath ? headingTree : [],
      };
    }
    return folderTree.map(toNavNode);
  }, [
    files,
    unloadedFolders,
    lazyDirSet,
    selectedPath,
    headingTree,
    threadCountsByPath,
  ]);

  // Auto-expand every ancestor folder of the selected file so the active row
  // stays visible after a navigation.
  React.useEffect(() => {
    /* v8 ignore next -- a document is always selected while the nav is mounted */
    if (!selectedPath) return;
    const ancestors = pathAncestors(selectedPath);
    if (ancestors.length === 0) return;
    setCollapsedDirs((curr) => {
      let changed = false;
      const next = new Set(curr);
      for (const dir of ancestors) {
        if (next.has(dir)) {
          next.delete(dir);
          changed = true;
        }
      }
      if (!changed) return curr;
      writeCollapsedDirs(folderStorageKey, next);
      return next;
    });
  }, [selectedPath, folderStorageKey]);

  // Deep-link reveal: lazily fetch any *unenumerated* ancestor folder of the
  // selected file so a deep-linked path surfaces in the tree (the un-collapse
  // effect above only helps folders already in `files`). Re-runs as each
  // level's contents stream in via `lazyDirSet`, expanding the next level down.
  // Each ancestor is attempted at most once (tracked in `autoExpandedRef`) so a
  // folder that stays lazy after its fetch doesn't get re-fetched on every
  // `lazyDirSet` change.
  const autoExpandedRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    /* v8 ignore next -- a document is always selected while the nav is mounted */
    if (!selectedPath) return;
    for (const dir of pathAncestors(selectedPath)) {
      if (lazyDirSet.has(dir) && !autoExpandedRef.current.has(dir)) {
        autoExpandedRef.current.add(dir);
        expandLazyDir(dir);
      }
    }
  }, [selectedPath, lazyDirSet, expandLazyDir]);

  const toggleDir = React.useCallback(
    (dirPath: string) => {
      setCollapsedDirs((curr) => {
        const next = new Set(curr);
        if (next.has(dirPath)) next.delete(dirPath);
        else next.add(dirPath);
        writeCollapsedDirs(folderStorageKey, next);
        return next;
      });
    },
    [folderStorageKey],
  );

  if (files.length === 0 && (unloadedFolders?.length ?? 0) === 0) return null;

  // -----------------------------------------------------------------------
  // File-row click: produce a single active state on the row. Switch files
  // for a different path; scroll back to top for the same path.
  // -----------------------------------------------------------------------
  const onSelectFile = React.useCallback(
    (path: string) => {
      // Suppress scroll-spy briefly so the scroll back to top doesn't blip a
      // heading active state on the way up.
      spyLockUntilRef.current = performance.now() + 700;
      setActiveId(null);
      if (path !== selectedPath) {
        onSelectPath(path);
      } else {
        const scroller = scrollRef.current;
        /* v8 ignore next -- scroll-to-top only when re-selecting the active file; scroller absent only pre-mount */
        if (scroller) scroller.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    [onSelectPath, selectedPath, scrollRef],
  );

  return (
    <ChangeIndicatorContext.Provider value={showChangeIndicators}>
      <aside className="emr-docnav" aria-label="Document navigation">
        <div className="emr-docnav-header">
          {searchOpen ? (
            <input
              ref={searchInputRef}
              type="search"
              className="emr-docnav-search-inline"
              placeholder="Find a document or folder..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  // Let the user clear with Esc without also dismissing
                  // any global selection state.
                  e.stopPropagation();
                  if (searchQuery) setSearchQuery("");
                  else setSearchOpen(false);
                }
              }}
              onBlur={() => {
                // Collapse only if the user hasn't typed anything.
                if (!searchQuery) setSearchOpen(false);
              }}
              aria-label="Search documents"
              autoComplete="off"
              spellCheck={false}
            />
          ) : (
            (titleSlot ?? <span className="emr-docnav-title">Documents</span>)
          )}
          {headerActions}
          {files.length >= 5 ||
          (unloadedFolders?.length ?? 0) > 0 ||
          isSearching ? (
            <button
              type="button"
              className={`emr-icon-btn${searchOpen ? " is-open" : ""}`}
              title={searchOpen ? "Close search (Esc)" : "Search documents"}
              aria-label={searchOpen ? "Close search" : "Search documents"}
              aria-pressed={searchOpen}
              onClick={searchOpen ? closeSearch : () => setSearchOpen(true)}
            >
              {searchOpen ? <SvgX /> : <SvgSearch />}
            </button>
          ) : null}
        </div>

        <nav
          className="emr-docnav-list"
          ref={listRef as React.Ref<HTMLElement>}
        >
          {isSearching ? (
            <SearchResultsList
              results={searchResults}
              loading={remoteLoading}
              query={trimmedQuery}
              unavailable={onSearchFiles ? searchUnavailable : null}
              selectedPath={selectedPath}
              threadCountsByPath={threadCountsByPath}
              onSelectFile={onSelectFile}
            />
          ) : (
            tree.map((node) => (
              <NavTreeItem
                key={navNodeKey(node)}
                node={node}
                depth={0}
                activeId={activeId}
                collapsedIds={collapsedIds}
                collapsedDirs={collapsedDirs}
                loadingDirs={loadingDirs}
                selectedPath={selectedPath}
                onSelectHeading={scrollTo}
                onToggleHeading={toggleSection}
                onSelectFile={onSelectFile}
                onToggleDir={toggleDir}
                onExpandLazyDir={expandLazyDir}
              />
            ))
          )}
        </nav>
      </aside>
    </ChangeIndicatorContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// NavTreeItem — recursive renderer. "file" rows switch the active file (or
// scroll to top) and show change icon, name, diff stats, and a comment badge;
// "heading" rows scroll on click and fold the doc section + nav children via
// the chevron.
// ---------------------------------------------------------------------------

interface NavTreeItemProps {
  node: NavNode;
  depth: number;
  activeId: string | null;
  collapsedIds: Set<string>;
  collapsedDirs: Set<string>;
  /** Folder paths whose lazy-fetch is in flight. */
  loadingDirs: Set<string>;
  selectedPath: string;
  onSelectHeading: (id: string) => void;
  onToggleHeading: (id: string) => void;
  onSelectFile: (path: string) => void;
  onToggleDir: (path: string) => void;
  /** Trigger a lazy fetch of a folder's children. No-op for regular dirs. */
  onExpandLazyDir: (path: string) => void;
}

function NavTreeItem(props: NavTreeItemProps): React.ReactElement {
  const {
    node,
    depth,
    activeId,
    collapsedIds,
    collapsedDirs,
    loadingDirs,
    selectedPath,
    onSelectHeading,
    onToggleHeading,
    onSelectFile,
    onToggleDir,
    onExpandLazyDir,
  } = props;

  if (node.kind === "dir") {
    const isLazy = node.lazy === true;
    const isLoading = loadingDirs.has(node.path);
    // Lazy folders are always "collapsed" until the user triggers a fetch
    // via the chevron or label.
    const isCollapsed = isLazy ? !isLoading : collapsedDirs.has(node.path);
    const onDirToggle = (): void => {
      if (isLazy) onExpandLazyDir(node.path);
      else onToggleDir(node.path);
    };
    return (
      <div
        className={
          "emr-docnav-branch emr-docnav-dir-branch" + (isLazy ? " is-lazy" : "")
        }
      >
        <div
          className={
            "emr-docnav-item emr-docnav-dir" + (isLoading ? " is-loading" : "")
          }
          style={
            {
              ["--emr-nav-depth" as keyof React.CSSProperties]: depth,
            } as React.CSSProperties
          }
        >
          <button
            type="button"
            className="emr-docnav-twist"
            onClick={(e) => {
              e.stopPropagation();
              onDirToggle();
            }}
            aria-label={
              isLazy
                ? isLoading
                  ? "Loading folder..."
                  : "Load folder"
                : isCollapsed
                  ? "Expand folder"
                  : "Collapse folder"
            }
            aria-expanded={!isCollapsed}
            aria-busy={isLoading || undefined}
            title={
              isLazy
                ? isLoading
                  ? "Loading…"
                  : "Click to load contents"
                : isCollapsed
                  ? "Expand folder"
                  : "Collapse folder"
            }
            data-collapsed={isCollapsed ? "true" : undefined}
            disabled={isLoading}
          >
            {isLoading ? <SvgSpinner /> : <SvgCaret />}
          </button>
          <button
            type="button"
            className="emr-docnav-label emr-docnav-dir-label"
            onClick={onDirToggle}
            title={node.path}
            disabled={isLoading}
          >
            <span
              className="emr-docnav-file-icon emr-docnav-folder-icon"
              aria-hidden
            >
              <SvgFolder open={!isCollapsed} />
            </span>
            <span className="emr-docnav-item-text">{node.displayName}</span>
            {isLazy && !isLoading ? (
              <span className="emr-docnav-lazy-hint" aria-hidden>
                …
              </span>
            ) : null}
          </button>
        </div>
        {!isCollapsed && node.children.length > 0 ? (
          <div className="emr-docnav-children">
            {node.children.map((child) => (
              <NavTreeItem
                key={navNodeKey(child)}
                node={child}
                depth={depth + 1}
                activeId={activeId}
                collapsedIds={collapsedIds}
                collapsedDirs={collapsedDirs}
                loadingDirs={loadingDirs}
                selectedPath={selectedPath}
                onSelectHeading={onSelectHeading}
                onToggleHeading={onToggleHeading}
                onSelectFile={onSelectFile}
                onToggleDir={onToggleDir}
                onExpandLazyDir={onExpandLazyDir}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (node.kind === "file") {
    return (
      <FileNavRow
        file={node.file}
        openComments={node.openComments}
        children={node.children}
        depth={depth}
        activeId={activeId}
        collapsedIds={collapsedIds}
        collapsedDirs={collapsedDirs}
        loadingDirs={loadingDirs}
        selectedPath={selectedPath}
        onSelectHeading={onSelectHeading}
        onToggleHeading={onToggleHeading}
        onSelectFile={onSelectFile}
        onToggleDir={onToggleDir}
        onExpandLazyDir={onExpandLazyDir}
      />
    );
  }

  const h = node.heading;
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsedIds.has(h.id);
  const isActive = h.id === activeId;
  return (
    <div className="emr-docnav-branch">
      <div
        className={
          "emr-docnav-item" +
          ` lvl-${h.level}` +
          (isActive ? " is-active" : "") +
          (hasChildren ? " has-children" : "")
        }
        data-nav-id={h.id}
        style={
          {
            ["--emr-nav-depth" as keyof React.CSSProperties]: depth,
          } as React.CSSProperties
        }
      >
        {hasChildren ? (
          <button
            type="button"
            className="emr-docnav-twist"
            onClick={(e) => {
              e.stopPropagation();
              onToggleHeading(h.id);
            }}
            aria-label={isCollapsed ? "Expand section" : "Collapse section"}
            aria-expanded={!isCollapsed}
            title={isCollapsed ? "Expand section" : "Collapse section"}
            data-collapsed={isCollapsed ? "true" : undefined}
          >
            <SvgCaret />
          </button>
        ) : (
          <span className="emr-docnav-twist-spacer" aria-hidden />
        )}
        <button
          type="button"
          className="emr-docnav-label"
          onClick={() => onSelectHeading(h.id)}
          title={
            h.openComments > 0
              ? `${h.text} \u2014 ${h.openComments} open comment${h.openComments === 1 ? "" : "s"}`
              : h.text
          }
        >
          <span className="emr-docnav-item-text">{h.text}</span>
          {h.openComments > 0 ? (
            <span
              className="emr-docnav-badge is-open"
              aria-label={`${h.openComments} open comments`}
            >
              {h.openComments}
            </span>
          ) : h.totalComments > 0 ? (
            <span
              className="emr-docnav-badge is-resolved"
              aria-label={`${h.totalComments} resolved comments`}
            >
              {h.totalComments}
            </span>
          ) : null}
        </button>
      </div>
      {hasChildren && !isCollapsed ? (
        <div className="emr-docnav-children">
          {node.children.map((child) => (
            <NavTreeItem
              key={navNodeKey(child)}
              node={child}
              depth={depth + 1}
              activeId={activeId}
              collapsedIds={collapsedIds}
              collapsedDirs={collapsedDirs}
              loadingDirs={loadingDirs}
              selectedPath={selectedPath}
              onSelectHeading={onSelectHeading}
              onToggleHeading={onToggleHeading}
              onSelectFile={onSelectFile}
              onToggleDir={onToggleDir}
              onExpandLazyDir={onExpandLazyDir}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FileNavRow — top-level file row. Clicking the label switches the active file
// (or scrolls to the top of the current one). The heading-tree children render
// only for the selected file, and the row lights up only when no heading is
// active (single-selection model).
// ---------------------------------------------------------------------------

interface FileNavRowProps {
  file: FileInfo;
  openComments: number;
  children: NavNode[];
  depth: number;
  activeId: string | null;
  collapsedIds: Set<string>;
  collapsedDirs: Set<string>;
  loadingDirs: Set<string>;
  selectedPath: string;
  onSelectHeading: (id: string) => void;
  onToggleHeading: (id: string) => void;
  onSelectFile: (path: string) => void;
  onToggleDir: (path: string) => void;
  onExpandLazyDir: (path: string) => void;
}

function FileNavRow(props: FileNavRowProps): React.ReactElement {
  const {
    file,
    openComments,
    children,
    depth,
    activeId,
    collapsedIds,
    collapsedDirs,
    loadingDirs,
    selectedPath,
    onSelectHeading,
    onToggleHeading,
    onSelectFile,
    onToggleDir,
    onExpandLazyDir,
  } = props;
  const showChangeIndicators = React.useContext(ChangeIndicatorContext);
  // Single selection: the file row lights up only when no heading is
  // active (user is at the top of the current file). Everything else \u2014
  // "this file is loaded" \u2014 is implicit from which row carries its
  // heading children beneath it.
  const isActive = file.path === selectedPath && activeId === null;
  const fileName = basename(file.path);
  const renamedFromName = file.renamedFrom ? basename(file.renamedFrom) : null;
  const titleText =
    file.changeType === "renamed" && renamedFromName
      ? `${renamedFromName} \u2192 ${fileName}`
      : file.path;
  return (
    <div className="emr-docnav-branch emr-docnav-file-branch">
      <div
        className={
          "emr-docnav-item emr-docnav-file" + (isActive ? " is-active" : "")
        }
        data-change-type={file.changeType}
        style={
          {
            ["--emr-nav-depth" as keyof React.CSSProperties]: depth,
          } as React.CSSProperties
        }
      >
        {/* File rows have no leading twist-spacer: the change-type icon is the
            leading affordance. Nested headings indent via `--emr-nav-depth`. */}
        <button
          type="button"
          className="emr-docnav-label emr-docnav-file-label"
          onClick={() => onSelectFile(file.path)}
          title={titleText}
        >
          {showChangeIndicators ? (
            <span
              className={"emr-docnav-file-icon is-" + file.changeType}
              aria-hidden
            >
              {changeTypeGlyph(file.changeType)}
            </span>
          ) : null}
          <span className="emr-docnav-file-name">{fileName}</span>
          {openComments > 0 ? (
            <span
              className="emr-docnav-badge is-open"
              aria-label={`${openComments} open comments`}
            >
              {openComments}
            </span>
          ) : null}
        </button>
      </div>
      {children.length > 0 ? (
        <div className="emr-docnav-children emr-docnav-file-children">
          {children.map((child) => (
            <NavTreeItem
              key={navNodeKey(child)}
              node={child}
              // Headings nested under a file get a single depth bump so
              // they visually indent past the file name without wasting
              // horizontal space. The chevron lands in the file row's
              // "icon column" and the heading text sits just to the
              // right of the file name \u2014 tight but unambiguous
              // hierarchy.
              depth={depth + 1}
              activeId={activeId}
              collapsedIds={collapsedIds}
              collapsedDirs={collapsedDirs}
              loadingDirs={loadingDirs}
              selectedPath={selectedPath}
              onSelectHeading={onSelectHeading}
              onToggleHeading={onToggleHeading}
              onSelectFile={onSelectFile}
              onToggleDir={onToggleDir}
              onExpandLazyDir={onExpandLazyDir}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function basename(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? p : p.slice(idx + 1);
}

function changeTypeGlyph(t: ChangeType): string {
  switch (t) {
    case "added":
      return "A";
    case "modified":
      return "M";
    case "renamed":
      return "R";
    case "deleted":
      return "D";
  }
}

/** Tiny CSS.escape polyfill so we don't pull a dep. */
function cssEscape(s: string): string {
  /* v8 ignore next -- the native-CSS.escape fallback path is dead in all supported browsers */
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  /* v8 ignore next -- CSS.escape is available in all supported browsers */
  return s.replace(/([^\w-])/g, "\\$1");
}

/**
 * Stable React list key for every NavNode kind. Dir paths, file paths (always
 * carry an extension), and slug-prefixed heading ids cannot collide.
 */
function navNodeKey(node: NavNode): string {
  if (node.kind === "dir") return `dir:${node.path}`;
  if (node.kind === "file") return `file:${node.file.path}`;
  return `heading:${node.heading.id}`;
}

/**
 * Return every ancestor folder path a file lives under, used to auto-expand
 * the selected file's parents.
 *
 *   pathAncestors("docs/api/v2/auth.md")
 *     → ["docs", "docs/api", "docs/api/v2"]
 */
function pathAncestors(path: string): string[] {
  const segments = path.replace(/^\/+/, "").split("/").filter(Boolean);
  if (segments.length <= 1) return [];
  const out: string[] = [];
  let acc = "";
  for (let i = 0; i < segments.length - 1; i += 1) {
    acc = acc ? `${acc}/${segments[i]!}` : segments[i]!;
    out.push(acc);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Inline SVGs (no external icon dep). Stroke matches our other custom icons.
// ---------------------------------------------------------------------------

function SvgCaret(): React.ReactElement {
  // Chevron rotated via CSS from the button's `data-collapsed` attribute.
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3.5,2 6.5,5 3.5,8" />
    </svg>
  );
}

function SvgFolder(props: { open: boolean }): React.ReactElement {
  // Open / closed glyph picked on `open`.
  if (props.open) {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M1.5 4.5 V12 a1 1 0 0 0 1 1 H13.5 L14.5 7 H4 L3 4.5 H1.5 Z" />
        <path d="M1.5 4.5 V3.5 a1 1 0 0 1 1 -1 H6 L7.5 4.5 H1.5 Z" />
      </svg>
    );
  }
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.5 3.5 a1 1 0 0 1 1 -1 H6 L7.5 4 H13.5 a1 1 0 0 1 1 1 V12 a1 1 0 0 1 -1 1 H2.5 a1 1 0 0 1 -1 -1 Z" />
    </svg>
  );
}

function SvgSearch(): React.ReactElement {
  // Identical to RailToolbar's SvgSearch (same 14x14 size + 1.6 stroke) so the
  // search affordance reads the same in the document and comment headers.
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function SvgSpinner(): React.ReactElement {
  // CSS-animated stroke spinner; the rotation is driven by the
  // `.emr-docnav-spinner` keyframe in styles.scss.
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className="emr-docnav-spinner"
      aria-hidden="true"
    >
      <path d="M8 2 a6 6 0 0 1 6 6" />
    </svg>
  );
}

function SvgInfo(): React.ReactElement {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" />
      <line x1="8" y1="7" x2="8" y2="11" />
      <circle cx="8" cy="5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SvgX(): React.ReactElement {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </svg>
  );
}

/**
 * Map an `AlmSearchError.kind` to a short user-facing string for the
 * "search unavailable" banner.
 */
function unavailableMessage(reason: string): string {
  switch (reason) {
    case "extension-missing":
      return "Code Search isn't installed in this org. Showing local matches only.";
    case "auth":
      return "Couldn't authenticate to Code Search. Showing local matches only.";
    case "network":
      return "Couldn't reach Code Search. Showing local matches only.";
    case "bad-request":
      return "Code Search rejected this query. Showing local matches only.";
    case "no-config":
      return "Code Search isn't available here. Showing local matches only.";
    default:
      return "Code Search is unavailable right now. Showing local matches only.";
  }
}

// ---------------------------------------------------------------------------
// SearchResultsList — flat results renderer used while searching. Mirrors the
// file-row template but omits the heading sub-tree.
// ---------------------------------------------------------------------------

interface SearchResultsListProps {
  results: ReadonlyArray<FileInfo>;
  loading: boolean;
  query: string;
  /**
   * Non-null when the most recent remote search call returned a
   * `kind: "unavailable"` outcome. Surfaces a small inline banner
   * above the local results so the user knows why the remote search
   * isn't contributing matches.
   */
  unavailable: { reason: string; message?: string } | null;
  selectedPath: string;
  threadCountsByPath: Record<string, number>;
  onSelectFile: (path: string) => void;
}

function SearchResultsList(props: SearchResultsListProps): React.ReactElement {
  const {
    results,
    loading,
    query,
    unavailable,
    selectedPath,
    threadCountsByPath,
    onSelectFile,
  } = props;
  const showChangeIndicators = React.useContext(ChangeIndicatorContext);
  const banner = unavailable ? (
    <div
      className="emr-docnav-search-unavailable"
      role="status"
      aria-live="polite"
      title={unavailable.message ?? undefined}
    >
      <SvgInfo />
      <span>{unavailableMessage(unavailable.reason)}</span>
    </div>
  ) : null;
  if (results.length === 0) {
    return (
      <>
        {banner}
        <div className="emr-docnav-search-empty">
          {loading
            ? `Searching for "${query}"…`
            : query.length < 2
              ? "Type at least 2 characters to search."
              : `No files match "${query}".`}
        </div>
      </>
    );
  }
  return (
    <>
      {banner}
      {/* v8 ignore start -- incremental repo-search loading state; timing not reproduced in the render harness */}
      {loading ? (
        <div className="emr-docnav-search-status" aria-live="polite">
          Searching the repo for more matches…
        </div>
      ) : null}
      {/* v8 ignore stop */}
      {results.map((file) => {
        const isActive = file.path === selectedPath;
        const fileName = basename(file.path);
        const parentPath = file.path
          .replace(/^\/+/, "")
          .replace(/\/[^/]*$/, "");
        const openComments = threadCountsByPath[file.path] ?? 0;
        return (
          <div
            key={`search:${file.path}`}
            className={
              "emr-docnav-item emr-docnav-search-result" +
              (isActive ? " is-active" : "")
            }
            data-change-type={file.changeType}
          >
            <button
              type="button"
              className="emr-docnav-label emr-docnav-search-label"
              onClick={() => onSelectFile(file.path)}
              title={file.path}
            >
              {showChangeIndicators ? (
                <span
                  className={"emr-docnav-file-icon is-" + file.changeType}
                  aria-hidden
                >
                  {changeTypeGlyph(file.changeType)}
                </span>
              ) : null}
              <span className="emr-docnav-search-name">{fileName}</span>
              {/* v8 ignore start -- parent-path label only renders for nested search results */}
              {parentPath ? (
                <span className="emr-docnav-search-path" title={parentPath}>
                  {parentPath}
                </span>
              ) : null}
              {/* v8 ignore stop */}
              {openComments > 0 ? (
                <span
                  className="emr-docnav-badge is-open"
                  aria-label={`${openComments} open comments`}
                >
                  {openComments}
                </span>
              ) : null}
            </button>
          </div>
        );
      })}
    </>
  );
}
