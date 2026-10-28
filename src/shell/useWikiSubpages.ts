// `[[_TOSP_]]` subpage tables for the shown document. They never hold up the
// document: it paints with a loading table, then the page's subpage folder is
// listed — at the shown version's commit — and the table fills in. Listings
// are cached per document version. Detection uses the rendered HTML, so only a
// real subpages box triggers a listing.

import * as React from "react";

import {
  fillSubpagesMacros,
  hasSubpagesMacro,
  type SubpagesState,
} from "../markdown/wikiMacros";
import type { FolderLister } from "./wikiOrder";
import { loadWikiSubpages } from "./wikiSubpages";

export interface WikiSubpagesInput {
  /** The shown document's rendered HTML. */
  html: string;
  /** Repo path of the shown document. */
  documentPath: string;
  /** True when a historical version (at `commitId`) is shown. */
  historical: boolean;
  /** Commit of the shown historical version. */
  commitId?: string | null;
  /** Lists a repository folder; undefined where folders can't be listed. */
  listFolder: FolderLister | undefined;
}

/** `html` with its `[[_TOSP_]]` tables showing the shown version's subpages. */
export function useWikiSubpages(input: WikiSubpagesInput): string {
  const { html, documentPath, listFolder } = input;
  // Historical content only loads for a stop with a commit, so one is set.
  const atCommitId = input.historical ? input.commitId! : undefined;
  const [byVersion, setByVersion] = React.useState<
    Record<string, SubpagesState>
  >({});
  // Read when a listing starts, so a host passing a fresh callback doesn't
  // re-list.
  const listFolderRef = React.useRef(listFolder);
  listFolderRef.current = listFolder;

  const key = `${documentPath}\u0000${atCommitId ?? ""}`;
  const canList = listFolder !== undefined;
  const needsListing =
    canList && hasSubpagesMacro(html) && byVersion[key] === undefined;
  React.useEffect(() => {
    if (!needsListing) return;
    void loadWikiSubpages(
      documentPath,
      listFolderRef.current!,
      atCommitId,
    ).then((subpages) => {
      setByVersion((prev) => ({
        ...prev,
        [key]: subpages ?? "unavailable",
      }));
    });
  }, [needsListing, documentPath, atCommitId, key]);

  const state: SubpagesState = canList
    ? (byVersion[key] ?? "loading")
    : "unavailable";
  return React.useMemo(() => fillSubpagesMacros(html, state), [html, state]);
}
