// PrShell article column: the document, or its load error / skeleton / absent notice.

import * as React from "react";

import { ArticleSkeleton } from "./Skeletons";

interface ArticleColumnProps {
  hideDocNav: boolean | undefined;
  selectedPath: string;
  /** The live document's load error. */
  error: string | null;
  loading: boolean;
  pristineHtml: string;
  absentNotice: { title: string; body: string } | null;
  onShowAllUpdates: () => void;
  historicalLoadError: string | undefined;
  historicalLoading: boolean;
  /** The ArticleView shown once the document is ready. */
  children: React.ReactNode;
}

/**
 * The article column. Per-file loading + render errors are scoped here (and
 * the comment rail) so switching files never blanks the whole shell — only the
 * middle + rail swap to a subtle skeleton while the next file streams in. The
 * nav rail is a left sibling.
 */
export function ArticleColumn(props: ArticleColumnProps): React.ReactElement {
  return (
    <div className={`emr-grid${props.hideDocNav ? " emr-grid--no-nav" : ""}`}>
      <ArticleColumnContent {...props} />
    </div>
  );
}

function ArticleColumnContent(props: ArticleColumnProps): React.ReactNode {
  const { selectedPath, absentNotice } = props;
  if (props.error) {
    return (
      <div className="emr-article-wrap">
        <div className="emr-error">
          <h2>Couldn&rsquo;t open this document</h2>
          <p>
            <code>{selectedPath}</code> couldn&rsquo;t be loaded. It may have
            been moved or deleted, or you may not have access to it. Pick
            another document from the navigation.
          </p>
          <pre>{props.error}</pre>
        </div>
      </div>
    );
  }
  if (props.loading && !props.pristineHtml) return <ArticleSkeleton />;
  if (absentNotice) {
    return (
      <div className="emr-article-wrap">
        <div className="emr-update-absent" role="status">
          <h2>{absentNotice.title}</h2>
          <p>
            <code>{selectedPath}</code>: {absentNotice.body}
          </p>
          <button
            type="button"
            className="emr-update-absent-action"
            onClick={props.onShowAllUpdates}
          >
            Show all updates
          </button>
        </div>
      </div>
    );
  }
  if (props.historicalLoadError) {
    return (
      <div className="emr-article-wrap">
        <div className="emr-error">
          <h2>Couldn&rsquo;t load this version</h2>
          <p>
            <code>{selectedPath}</code> couldn&rsquo;t be loaded at the selected
            revision. It may not exist at that commit, or you may not have
            access to it.
          </p>
          <pre>{props.historicalLoadError}</pre>
        </div>
      </div>
    );
  }
  if (props.historicalLoading) return <ArticleSkeleton />;
  return props.children;
}
