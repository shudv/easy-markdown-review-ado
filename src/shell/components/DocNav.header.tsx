// Header of the document navigation rail: title or search box + toggle.

import * as React from "react";

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
  searchInputRef: React.RefObject<HTMLInputElement>;
  /** Offer the search toggle (enough documents, or a search in progress). */
  showSearchToggle: boolean;
  titleSlot?: React.ReactNode;
  headerActions?: React.ReactNode;
}

export function DocNavHeader(props: DocNavHeaderProps): React.ReactElement {
  const { searchQuery, setSearchQuery, searchOpen, setSearchOpen } = props;
  return (
    <div className="emr-docnav-header">
      {searchOpen ? (
        <input
          ref={props.searchInputRef}
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
        (props.titleSlot ?? <span className="emr-docnav-title">Documents</span>)
      )}
      {props.headerActions}
      {props.showSearchToggle ? (
        <SearchToggleButton
          searchOpen={searchOpen}
          closeSearch={props.closeSearch}
          setSearchOpen={setSearchOpen}
        />
      ) : null}
    </div>
  );
}

function SearchToggleButton(props: {
  searchOpen: boolean;
  closeSearch: () => void;
  setSearchOpen: (open: boolean) => void;
}): React.ReactElement {
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
