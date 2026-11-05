// Flat DocNav search-results list shown while the file finder is active.

import { type ReactElement, useContext } from "react";

import type { FileInfo } from "../../types";
import {
  ChangeIndicatorContext,
  RangeChangesContext,
  fileChangeView,
  basename,
  changeTypeGlyph,
} from "./DocNav.model";
import { SvgInfo } from "./DocNav.icons";

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

// eslint-disable-next-line max-lines-per-function -- Navigation search results: result rows with keyboard selection and ARIA listbox semantics in one list.
export function SearchResultsList(
  props: Readonly<SearchResultsListProps>,
): ReactElement {
  const {
    results,
    loading,
    query,
    unavailable,
    selectedPath,
    threadCountsByPath,
    onSelectFile,
  } = props;
  const showChangeIndicators = useContext(ChangeIndicatorContext);
  const rangeChanges = useContext(RangeChangesContext);
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
      {loading ? (
        <div className="emr-docnav-search-status" aria-live="polite">
          Searching the repo for more matches…
        </div>
      ) : null}
      {results.map((file) => {
        const isActive = file.path === selectedPath;
        const fileName = basename(file.path);
        const parentPath = file.path
          .replace(/^\/+/, "")
          .replace(/\/[^/]*$/, "");
        const openComments = threadCountsByPath[file.path] ?? 0;
        const change = fileChangeView(file, rangeChanges);
        const note = change.note ?? "";
        return (
          <div
            key={`search:${file.path}`}
            className={
              "emr-docnav-item emr-docnav-search-result" +
              (isActive ? " is-active" : "") +
              (change.unchanged ? " is-unchanged-in-range" : "")
            }
            data-change-type={change.changeType}
          >
            <button
              type="button"
              className="emr-docnav-label emr-docnav-search-label"
              onClick={() => onSelectFile(file.path)}
              title={file.path + (note !== "" ? ` \u2014 ${note}` : "")}
            >
              {showChangeIndicators ? (
                <span
                  className={"emr-docnav-file-icon is-" + change.changeType}
                  aria-hidden
                >
                  {changeTypeGlyph(change.changeType)}
                </span>
              ) : null}
              <span className="emr-docnav-search-name">{fileName}</span>
              {note !== "" ? (
                <span className="emr-sr-only">{` (${note})`}</span>
              ) : null}
              {parentPath ? (
                <span className="emr-docnav-search-path" title={parentPath}>
                  {parentPath}
                </span>
              ) : /* v8 ignore next -- the parent path is empty only for an empty or slash-only path, and search results always name a file */ null}
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
