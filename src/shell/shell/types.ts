/** Compact summary of the PR a Documents-hub document routes its comments to. */
export interface RoutedPrInfo {
  prId: number;
  title: string;
  status: "active" | "completed";
  /** Optional pre-built URL the rail can link to. */
  url?: string;
}

/**
 * A relative-link navigation this reader hands to the host: opening a Markdown
 * document in the Documents hub, or a non-Markdown file in ADO's native Files
 * view. (In-place selections and anchor scrolls never reach the host.)
 */
export type DocLinkNavigation =
  | { kind: "hub-doc"; path: string; hash: string }
  | { kind: "repo-file"; path: string };
