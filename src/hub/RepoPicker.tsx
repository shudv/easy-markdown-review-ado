// Documents hub: the repository dropdown (search, listbox and keyboard navigation).

import {
  type CSSProperties,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { DocRepo } from "../shell/types";
import { SearchIcon } from "../shell/components/icons";
import { menuFocusTarget } from "./documentsApp.helpers";
import { SvgRepo } from "./hubIcons";

/**
 * Inline repo picker for the DocNav header. The repo name is the trigger —
 * clicking it (or pressing Enter/Space/ArrowDown) opens a dropdown listing the
 * project's repos. The menu is rendered with `position: fixed` anchored to the
 * trigger because the DocNav rail clips overflow, so an absolutely-positioned
 * popover would be cut off. Closes on outside click, Escape, scroll and resize;
 * arrow keys move focus between options.
 *
 * In paginated mode (`paginated`, used by the live hub) the menu grows a
 * keyword filter box (debounced server-side query via `onFilter`) and pages in
 * more repos as the user scrolls (`onLoadMore`), so it scales to projects with
 * thousands of repositories.
 */
// eslint-disable-next-line max-lines-per-function -- Repository dropdown: search box, listbox markup and keyboard navigation that share focus state. Kept whole so the ARIA listbox reads in one place.
export function RepoPicker({
  repos,
  selectedId,
  selectedName,
  onSelect,
  paginated = false,
  filter = "",
  hasMore = false,
  loading = false,
  onLoadMore,
  onFilter,
}: Readonly<{
  repos: DocRepo[];
  selectedId: string;
  /** Display name for the trigger; the selected repo may be outside the view. */
  selectedName?: string;
  onSelect: (repoId: string) => void;
  paginated?: boolean;
  filter?: string;
  hasMore?: boolean;
  loading?: boolean;
  onLoadMore?: () => void | Promise<void>;
  onFilter?: (keyword: string) => void | Promise<void>;
}>): ReactElement {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  // Local mirror of the filter text so typing is instant; the server query is
  // debounced off this value.
  const [filterText, setFilterText] = useState(filter);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const optionElsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const loadMoreRequestedRef = useRef(false);

  const triggerName =
    selectedName ?? repos.find((r) => r.id === selectedId)?.name;

  const openMenu = useCallback(() => {
    // Only the mounted trigger's own handlers call this, so the ref is set.
    const rect = triggerRef.current!.getBoundingClientRect();
    setMenuStyle({
      position: "fixed",
      top: Math.round(rect.bottom + 4),
      left: Math.round(rect.left),
      minWidth: Math.round(rect.width),
    });
    setOpen(true);
  }, []);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  // When opening: focus the filter box (paginated) or the selected option.
  useEffect(() => {
    if (!open) return;

    if (paginated) {
      filterInputRef.current?.focus();

      return;
    }

    const idx = Math.max(
      0,
      repos.findIndex((r) => r.id === selectedId),
    );

    optionElsRef.current[idx]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus only on open; re-focusing on every repos change would fight the user
  }, [open]);

  // Debounce the keyword filter: re-query 250ms after the last keystroke so a
  // burst of typing makes a single server round-trip.
  const onFilterRef = useRef(onFilter);
  useEffect(() => {
    onFilterRef.current = onFilter;
  }, [onFilter]);
  useEffect(() => {
    // Closed: the close effect below sends the single page-one re-query.
    if (!paginated || !open) return;
    if (filterText === filter) return; // already in sync (e.g. external reset)

    const handle = window.setTimeout(() => {
      void onFilterRef.current?.(filterText);
    }, 250);

    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `filter` is omitted on purpose: the debounce follows local input only
  }, [filterText, paginated, open]);

  // Match native ADO: clear the keyword filter whenever the picker closes, so
  // reopening always starts from the full, unfiltered list. Resets the local
  // input immediately and tells the host to re-query page one when a filter
  // was actually applied (avoids a needless round-trip on a plain open/close).
  // The local reset is adjusted during render on each open/close transition
  // (and on mount, via the `null` seed), matching the effect below.
  const [prevOpen, setPrevOpen] = useState<boolean | null>(null);

  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open && filterText !== "") setFilterText("");
  }

  useEffect(() => {
    if (open) return;
    if (paginated && filter !== "") void onFilterRef.current?.("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts only to open/close transitions, not to filter or paging changes
  }, [open]);

  // Dismiss on outside pointer, scroll (outside the menu) or resize while open.
  useEffect(() => {
    if (!open) return;

    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;

      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) {
        return;
      }

      setOpen(false);
    };

    // Close on scroll/resize since the menu is fixed to a now-stale rect — but
    // NOT when the scroll happens inside our own (paginated) results list.
    const onScrollCapture = (e: Event) => {
      if (listRef.current && e.target instanceof Node) {
        if (
          listRef.current === e.target ||
          listRef.current.contains(e.target)
        ) {
          return;
        }
      }

      setOpen(false);
    };

    const onResize = () => setOpen(false);
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("scroll", onScrollCapture, true);
    window.addEventListener("resize", onResize);

    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("scroll", onScrollCapture, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const choose = useCallback(
    (repoId: string) => {
      onSelect(repoId);
      close();
    },
    [onSelect, close],
  );

  useEffect(() => {
    if (!loading) loadMoreRequestedRef.current = false;
  }, [loading]);

  // Infinite scroll: when the results list nears its bottom, ask for the next
  // page. The ref closes the gap before the parent's loading prop re-renders,
  // when several scroll events can otherwise start the same page repeatedly.
  const onListScroll = useCallback(() => {
    if (
      !paginated ||
      !hasMore ||
      loading ||
      loadMoreRequestedRef.current ||
      !onLoadMore
    ) {
      return;
    }

    // Bound as the list's own onScroll, so the ref is always set here.
    const el = listRef.current!;

    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
      loadMoreRequestedRef.current = true;
      void onLoadMore();
    }
  }, [paginated, hasMore, loading, onLoadMore]);

  const onMenuKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();

      return;
    }

    const current = optionElsRef.current.findIndex(
      (el) => el === document.activeElement,
    );

    const target = menuFocusTarget(e.key, current, repos.length);
    if (target === undefined) return;
    e.preventDefault();
    optionElsRef.current[target]?.focus();
  };

  return (
    <div className="emr-docnav-repo">
      <button
        ref={triggerRef}
        type="button"
        className="emr-docnav-repo-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={triggerName}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(e) => {
          if (
            !open &&
            (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")
          ) {
            e.preventDefault();
            openMenu();
          }
        }}
      >
        <SvgRepo />
        <span className="emr-docnav-repo-name">{triggerName}</span>
        <SvgChevron />
      </button>
      {open ? (
        // eslint-disable-next-line jsx-a11y-x/no-static-element-interactions -- delegated key handler: focus lives on the filter input and option buttons, and their Escape/arrow keys bubble here.
        <div
          ref={menuRef}
          className={`emr-docnav-repo-menu${paginated ? " is-paginated" : ""}`}
          aria-label="Repository"
          style={menuStyle}
          onKeyDown={onMenuKeyDown}
        >
          {paginated ? (
            <RepoFilter
              inputRef={filterInputRef}
              filterText={filterText}
              setFilterText={setFilterText}
            />
          ) : null}
          <div
            ref={listRef}
            className="emr-docnav-repo-list"
            role="listbox"
            aria-label="Repository"
            onScroll={paginated ? onListScroll : undefined}
          >
            {repos.map((r, i) => {
              const isSelected = r.id === selectedId;

              return (
                <button
                  key={r.id}
                  ref={(el) => {
                    optionElsRef.current[i] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`emr-docnav-repo-option${
                    isSelected ? " is-selected" : ""
                  }`}
                  onClick={() => choose(r.id)}
                >
                  <SvgRepo />
                  <span className="emr-docnav-repo-option-name">{r.name}</span>
                  <span
                    className="emr-docnav-repo-option-check"
                    aria-hidden="true"
                  >
                    {isSelected ? <SvgCheck /> : null}
                  </span>
                </button>
              );
            })}
            {renderRepoListStatus(paginated, loading, repos.length, filterText)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Keyword filter box shown atop the paginated repo picker menu. */
function RepoFilter({
  inputRef,
  filterText,
  setFilterText,
}: Readonly<{
  inputRef: RefObject<HTMLInputElement>;
  filterText: string;
  setFilterText: (text: string) => void;
}>): ReactElement {
  return (
    <div className="emr-docnav-repo-filter">
      <SearchIcon size={14} className="emr-docnav-repo-filter-glyph" />
      <input
        ref={inputRef}
        type="text"
        className="emr-docnav-repo-filter-input"
        placeholder="Filter repositories"
        aria-label="Filter repositories"
        value={filterText}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setFilterText(e.target.value)}
      />
    </div>
  );
}

/** Trailing status row of the repo list (loading / no-match). */
function renderRepoListStatus(
  paginated: boolean,
  loading: boolean,
  count: number,
  filterText: string,
): ReactElement | null {
  if (paginated) return renderRepoPageStatus(loading, count, filterText);

  return count === 0 ? (
    <div className="emr-docnav-repo-status">
      No repositories match “{filterText.trim()}”.
    </div>
  ) : null;
}

function renderRepoPageStatus(
  loading: boolean,
  count: number,
  filterText: string,
): ReactElement {
  return (
    <div
      className="emr-docnav-repo-status emr-docnav-repo-page-status"
      role={loading ? "status" : undefined}
      aria-hidden={!loading && count > 0 ? "true" : undefined}
    >
      {loading ? (
        <>
          <span className="emr-docnav-repo-spinner" aria-hidden="true" />
          Loading repositories…
        </>
      ) : count === 0 ? (
        <>No repositories match “{filterText.trim()}”.</>
      ) : null}
    </div>
  );
}

function SvgChevron(): ReactElement {
  return (
    <svg
      className="emr-docnav-repo-chevron"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06L8.53 10.53a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
      />
    </svg>
  );
}

function SvgCheck(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        fill="currentColor"
        d="M13.78 4.22a.75.75 0 0 1 0 1.06l-6.25 6.25a.75.75 0 0 1-1.06 0l-2.75-2.75a.75.75 0 1 1 1.06-1.06L7 9.94l5.72-5.72a.75.75 0 0 1 1.06 0Z"
      />
    </svg>
  );
}
