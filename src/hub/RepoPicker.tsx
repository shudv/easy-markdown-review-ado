// Documents hub: the repository dropdown (search, listbox and keyboard navigation).

import * as React from "react";

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
}: {
  repos: DocRepo[];
  selectedId: string;
  /** Display name for the trigger; the selected repo may be outside the view. */
  selectedName?: string;
  onSelect: (repoId: string) => void;
  paginated?: boolean;
  filter?: string;
  hasMore?: boolean;
  loading?: boolean;
  onLoadMore?: () => void;
  onFilter?: (keyword: string) => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties>({});
  // Local mirror of the filter text so typing is instant; the server query is
  // debounced off this value.
  const [filterText, setFilterText] = React.useState(filter);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const filterInputRef = React.useRef<HTMLInputElement>(null);
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const loadMoreRequestedRef = React.useRef(false);

  const triggerName =
    selectedName ?? repos.find((r) => r.id === selectedId)?.name;

  const openMenu = React.useCallback(() => {
    const el = triggerRef.current;
    /* v8 ignore next -- openMenu only runs from the mounted trigger's own handlers */
    if (el) {
      const rect = el.getBoundingClientRect();
      setMenuStyle({
        position: "fixed",
        top: Math.round(rect.bottom + 4),
        left: Math.round(rect.left),
        minWidth: Math.round(rect.width),
      });
    }
    setOpen(true);
  }, []);

  const close = React.useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  // When opening: focus the filter box (paginated) or the selected option.
  React.useEffect(() => {
    if (!open) return;
    if (paginated) {
      filterInputRef.current?.focus();
      return;
    }
    const idx = Math.max(
      0,
      repos.findIndex((r) => r.id === selectedId),
    );
    optionRefs.current[idx]?.focus();
    // Only on open — re-focusing on every repos change would fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Debounce the keyword filter: re-query 250ms after the last keystroke so a
  // burst of typing makes a single server round-trip.
  const onFilterRef = React.useRef(onFilter);
  onFilterRef.current = onFilter;
  React.useEffect(() => {
    if (!paginated) return;
    if (filterText === filter) return; // already in sync (e.g. external reset)
    const handle = window.setTimeout(() => {
      onFilterRef.current?.(filterText);
    }, 250);
    return () => window.clearTimeout(handle);
    // `filter` intentionally omitted: we debounce off local input only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterText, paginated]);

  // Match native ADO: clear the keyword filter whenever the picker closes, so
  // reopening always starts from the full, unfiltered list. Resets the local
  // input immediately and tells the host to re-query page one when a filter
  // was actually applied (avoids a needless round-trip on a plain open/close).
  React.useEffect(() => {
    if (open) return;
    if (filterText !== "") setFilterText("");
    if (paginated && filter !== "") onFilterRef.current?.("");
    // Only react to open/close transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Dismiss on outside pointer, scroll (outside the menu) or resize while open.
  React.useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t))
        return;
      setOpen(false);
    };
    // Close on scroll/resize since the menu is fixed to a now-stale rect — but
    // NOT when the scroll happens inside our own (paginated) results list.
    const onScrollCapture = (e: Event) => {
      if (listRef.current && e.target instanceof Node) {
        if (listRef.current === e.target || listRef.current.contains(e.target))
          return;
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

  const choose = React.useCallback(
    (repoId: string) => {
      onSelect(repoId);
      close();
    },
    [onSelect, close],
  );

  React.useEffect(() => {
    if (!loading) loadMoreRequestedRef.current = false;
  }, [loading]);

  // Infinite scroll: when the results list nears its bottom, ask for the next
  // page. The ref closes the gap before the parent's loading prop re-renders,
  // when several scroll events can otherwise start the same page repeatedly.
  const onListScroll = React.useCallback(() => {
    if (
      !paginated ||
      !hasMore ||
      loading ||
      loadMoreRequestedRef.current ||
      !onLoadMore
    )
      return;
    const el = listRef.current;
    /* v8 ignore next -- the scroll handler is bound to the mounted list itself */
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
      loadMoreRequestedRef.current = true;
      onLoadMore();
    }
  }, [paginated, hasMore, loading, onLoadMore]);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    const current = optionRefs.current.findIndex(
      (el) => el === document.activeElement,
    );
    const target = menuFocusTarget(e.key, current, repos.length);
    if (target === undefined) return;
    e.preventDefault();
    optionRefs.current[target]?.focus();
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
        <div
          ref={menuRef}
          className={`emr-docnav-repo-menu${paginated ? " is-paginated" : ""}`}
          aria-label="Repository"
          style={menuStyle}
          onKeyDown={onMenuKeyDown}
        >
          {paginated
            ? renderRepoFilter(filterInputRef, filterText, setFilterText)
            : null}
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
                    optionRefs.current[i] = el;
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
function renderRepoFilter(
  inputRef: React.RefObject<HTMLInputElement>,
  filterText: string,
  setFilterText: (text: string) => void,
): React.ReactElement {
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
): React.ReactElement | null {
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
): React.ReactElement {
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

function SvgChevron(): React.ReactElement {
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

function SvgCheck(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        fill="currentColor"
        d="M13.78 4.22a.75.75 0 0 1 0 1.06l-6.25 6.25a.75.75 0 0 1-1.06 0l-2.75-2.75a.75.75 0 1 1 1.06-1.06L7 9.94l5.72-5.72a.75.75 0 0 1 1.06 0Z"
      />
    </svg>
  );
}
