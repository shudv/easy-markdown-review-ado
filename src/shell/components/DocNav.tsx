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

import type { FileInfo } from "../../types";
import type { FileSearchOutcome } from "../almSearch";
import type { ReaderActivity } from "./readerActivity";
import {
  buildFolderTree,
  mergeWikiPages,
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
import {
  ChangeIndicatorContext,
  type RangeChanges,
  RangeChangesContext,
  type NavHeading,
  type NavNode,
  cssEscape,
  shownActiveHeading,
  navNodeKey,
  pathAncestors,
} from "./DocNav.model";
import { DocNavHeader } from "./DocNav.header";
import { NavTreeItem } from "./DocNav.rows";
import { SearchResultsList } from "./DocNav.search";

export type { RangeChanges } from "./DocNav.model";

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
   * Azure DevOps wiki `.order` page names per folder (slash-free path, `""`
   * for the root). Listed entries sort first, in that order.
   */
  folderOrders?: Readonly<Record<string, readonly string[]>>;
  /**
   * Show Azure DevOps wiki pages the way the wiki does: a page `Foo.md` and
   * its subpage folder `Foo/` become one row that opens the page and expands
   * to its subpages (see `mergeWikiPages`). Off in the PR tab, where every
   * changed file keeps its own row.
   */
  wikiPages?: boolean;
  /**
   * List the open document's heading outline under its row. The reader's
   * opt-in "Outline" preference; defaults to shown for direct embeds.
   */
  showOutline?: boolean;
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
  /**
   * When comparing specific PR updates: which files those updates touch (by
   * change type) and the comparison's label. File rows then show the change
   * within the selection, and files it doesn't touch are dimmed. Omitted for
   * "All updates" (rows show the PR-wide change).
   */
  rangeChanges?: RangeChanges;
  /** Reports long-running navigation work to the reader status bar. */
  onActivitiesChange?: (activities: readonly ReaderActivity[]) => void;
}

const ACTIVE_MARGIN = 24; // px from top before a heading is "active"

const MAX_TREE_LEVEL = 4; // headings deeper than H4 are not shown in the nav

// eslint-disable-next-line max-lines-per-function -- Navigation pane: tree, search and outline share selection, expansion and keyboard state. Rows, header, search and model are in DocNav.* modules.
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
    folderOrders,
    wikiPages,
    showOutline,
    onSearchFiles,
    titleSlot,
    headerActions,
    showChangeIndicators = true,
    rangeChanges,
    onActivitiesChange,
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

  const navigationActivities = React.useMemo<readonly ReaderActivity[]>(() => {
    const activities: ReaderActivity[] = [];
    if (loadingDirs.size > 0) {
      activities.push({
        id: "folder",
        label:
          loadingDirs.size === 1
            ? `Loading ${[...loadingDirs][0]}…`
            : `Loading ${loadingDirs.size} folders…`,
        priority: 45,
      });
    }
    if (remoteLoading) {
      activities.push({
        id: "document-search",
        label: `Searching for “${trimmedQuery}”…`,
        priority: 40,
      });
    }
    return activities;
  }, [loadingDirs, remoteLoading, trimmedQuery]);
  React.useEffect(() => {
    onActivitiesChange?.(navigationActivities);
    return () => onActivitiesChange?.([]);
  }, [navigationActivities, onActivitiesChange]);

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
          text: h.textContent,
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
    if (!item) return;
    const itemRect = item.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    const margin = 16;
    if (itemRect.top < listRect.top + margin) {
      list.scrollTop -= listRect.top + margin - itemRect.top;
    } else if (itemRect.bottom > listRect.bottom - margin) {
      list.scrollTop += itemRect.bottom - (listRect.bottom - margin);
    }
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
  // the nearest preceding heading with a strictly lower level. Empty while the
  // reader has the outline turned off.
  // -----------------------------------------------------------------------
  const outlineShown = showOutline !== false;
  const headingTree = React.useMemo<NavNode[]>(() => {
    if (!outlineShown) return [];
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
  }, [headings, outlineShown]);
  // With the outline off no heading row exists to carry the active state, so
  // the open file's row keeps it while the reader scrolls.
  const navActiveId = shownActiveHeading(outlineShown, activeId);

  // -----------------------------------------------------------------------
  // Wrap the heading tree under the selected file node. Build a sorted
  // folder/file tree from `files`, then decorate each file with its
  // open-comment count and (for the selected file) the heading tree.
  // -----------------------------------------------------------------------
  const tree = React.useMemo<NavNode[]>(() => {
    const builtTree = buildFolderTree<FileInfo>(files, {
      extraFolders: unloadedFolders,
      folderOrders,
    });
    const folderTree = wikiPages ? mergeWikiPages(builtTree) : builtTree;
    function toNavNode(node: TreeNode<FileInfo>): NavNode {
      if (node.kind === "dir") {
        const dirNode = node as DirNode<FileInfo>;
        // "Lazy" iff the path is unloaded AND has no fetched children yet.
        const isLazy =
          dirNode.children.length === 0 && lazyDirSet.has(dirNode.path);
        const page = dirNode.page;
        return {
          kind: "dir",
          path: dirNode.path,
          displayName: dirNode.displayName,
          children: dirNode.children.map(toNavNode),
          lazy: isLazy,
          ...(page
            ? {
                page: {
                  file: page,
                  openComments: threadCountsByPath[page.path] ?? 0,
                },
                outline: page.path === selectedPath ? headingTree : [],
              }
            : {}),
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
    folderOrders,
    wikiPages,
    lazyDirSet,
    selectedPath,
    headingTree,
    threadCountsByPath,
  ]);

  // Auto-expand every ancestor folder of the selected file so the active row
  // stays visible after a navigation.
  React.useEffect(() => {
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
        if (scroller) scroller.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    [onSelectPath, selectedPath, scrollRef],
  );

  return (
    <ChangeIndicatorContext.Provider value={showChangeIndicators}>
      <RangeChangesContext.Provider value={rangeChanges}>
        <aside className="emr-docnav" aria-label="Document navigation">
          <DocNavHeader
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            searchOpen={searchOpen}
            setSearchOpen={setSearchOpen}
            closeSearch={closeSearch}
            searchInputRef={searchInputRef}
            showSearchToggle={
              files.length >= 5 ||
              (unloadedFolders?.length ?? 0) > 0 ||
              isSearching
            }
            titleSlot={titleSlot}
            headerActions={headerActions}
          />

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
                  activeId={navActiveId}
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
      </RangeChangesContext.Provider>
    </ChangeIndicatorContext.Provider>
  );
}
