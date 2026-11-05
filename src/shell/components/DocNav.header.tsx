// Header of the document navigation rail: title or search box + toggle.

import type { ReactElement, ReactNode, RefObject } from "react";

import { SearchIcon } from "./icons";
import { SvgX } from "./DocNav.icons";

// ---------------------------------------------------------------------------
// DocNavHeader — the rail title (or the inline search input while searching),
// the host's extra header actions, and the search toggle.
// ---------------------------------------------------------------------------

interface DocNavHeaderProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  closeSearch: () => void;
  searchInputRef: RefObject<HTMLInputElement>;
  /** Offer the search toggle (enough documents, or a search in progress). */
  showSearchToggle: boolean;
  titleSlot?: ReactNode;
  headerActions?: ReactNode;
}

export function DocNavHeader(props: Readonly<DocNavHeaderProps>): ReactElement {
  const {
    searchQuery,
    setSearchQuery,
    searchOpen,
    setSearchOpen,
    closeSearch,
    searchInputRef,
    showSearchToggle,
    titleSlot,
    headerActions,
  } = props;
  return (
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
      {showSearchToggle ? (
        <SearchToggleButton
          searchOpen={searchOpen}
          closeSearch={closeSearch}
          setSearchOpen={setSearchOpen}
        />
      ) : null}
    </div>
  );
}

function SearchToggleButton(
  props: Readonly<{
    searchOpen: boolean;
    closeSearch: () => void;
    setSearchOpen: (open: boolean) => void;
  }>,
): ReactElement {
  const { searchOpen, closeSearch, setSearchOpen } = props;
  return (
    <button
      type="button"
      className={`emr-icon-btn${searchOpen ? " is-open" : ""}`}
      title={searchOpen ? "Close search (Esc)" : "Search documents"}
      aria-label={searchOpen ? "Close search" : "Search documents"}
      aria-pressed={searchOpen}
      onClick={searchOpen ? closeSearch : () => setSearchOpen(true)}
    >
      {searchOpen ? <SvgX /> : <SearchIcon />}
    </button>
  );
}
