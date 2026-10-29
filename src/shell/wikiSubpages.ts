// Loading a wiki page's subpages for its `[[_TOSP_]]` table: the effectful
// glue around the pure ordering helpers in `./wikiOrder`.

import type { WikiSubpage } from "../markdown/wikiMacros";
import { trackUserFacingError } from "../telemetry";
import {
  subpagesFolderOf,
  subpagesFromListing,
  type FolderLister,
} from "./wikiOrder";

/**
 * The commit to list a shown version's subpages at: undefined for the current
 * version, null for a historical version without a commit. Its subpages can't
 * be listed then — listing the current branch would show the wrong ones.
 */
export function subpagesCommit(
  historical: boolean,
  commitId: string | null | undefined,
): string | null | undefined {
  return historical ? (commitId ?? null) : undefined;
}

/**
 * A document's subpages, listed at the same revision as the document
 * (`atCommitId` for a historical version). Resolves to undefined when the
 * listing fails — the table then says subpages aren't available, rather than
 * claiming there are none.
 */
export async function loadWikiSubpages(
  documentPath: string,
  listFolder: FolderLister,
  atCommitId?: string,
): Promise<WikiSubpage[] | undefined> {
  try {
    return subpagesFromListing(
      await listFolder(subpagesFolderOf(documentPath), atCommitId),
    );
  } catch (err) {
    console.warn("[wiki] listing subpages failed:", err);
    trackUserFacingError({
      error: err,
      source: "PrShell.subpages",
      operation: "subpages-load",
      impact: "degraded",
    });
    return undefined;
  }
}
