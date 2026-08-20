// Pure routing decisions extracted from `DocumentsApp` so the delicate
// default-document publish latch can be unit-tested without a full container
// render. The container is otherwise coverage-excluded (SDK-coupled), and the
// "publish the default doc exactly once, but only after the repo's files
// actually land" rule is exactly the kind of state-machine edge a line-coverage
// suite misses: in paginated mode a repo first arrives as a content-less
// skeleton, so a one-shot publish on repo-switch would drop the default doc.

/**
 * The document path to open/publish for a repo: a deep-link / cache path wins
 * (it's available immediately, no skeleton wait), otherwise the repo's first
 * file, otherwise `""` meaning "not resolved yet — try again on a later render".
 */
export function resolveInitialDocPath(
  deepLinkPath: string | undefined,
  firstFilePath: string | undefined,
): string {
  return deepLinkPath ?? firstFilePath ?? "";
}

/**
 * Whether the default document for `selectedRepoId` should be published to the
 * route now. True only when we haven't already published THIS repo AND a real
 * path has resolved. The empty-path guard is what makes the publish retry
 * across the skeleton→files-land renders instead of latching on the empty
 * skeleton and never publishing the default doc.
 */
export function shouldPublishDefaultPath(
  publishedRepoId: string | null,
  selectedRepoId: string,
  path: string,
): boolean {
  if (publishedRepoId === selectedRepoId) return false;
  return path !== "";
}
