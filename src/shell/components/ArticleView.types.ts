// Public shapes shared by `ArticleView` and its helper modules. Kept separate
// so the helpers never import from ArticleView.tsx (no import cycles).

export interface AnchorLayout {
  /** Map from thread id → top px (relative to article-wrap). */
  yByThreadId: Map<string, number>;
  /** Threads whose anchor could not be resolved in the current HTML. */
  orphanedThreadIds: string[];
}

/** Why a selection can't be commented on, and what to do instead. */
export interface CommentBlock {
  message: string;
  actionLabel: string;
  onAction: () => void;
}

/** What "Copy link to selection" links to. */
export interface SelectionLinkTarget {
  /** Serialized text fragment (see `serializeTextFragment`). */
  text: string;
  /** Id of the heading whose section holds the selection, if any. */
  anchor?: string;
}
