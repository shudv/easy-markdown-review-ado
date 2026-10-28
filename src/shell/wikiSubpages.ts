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
