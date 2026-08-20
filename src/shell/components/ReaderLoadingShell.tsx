import React, {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";

import type { DraftScope } from "../draftStorage";
import { readReaderPrefs, resolveReaderFont, widthScale } from "../readerPrefs";

interface ReaderLoadingShellProps {
  scope: DraftScope;
  ariaLabel: string;
  hideDocNav?: boolean;
  titleSlot?: ReactNode;
  headerActions?: ReactNode;
}

/** The settled reader geometry, filled with quiet placeholders during boot. */
export function ReaderLoadingShell({
  scope,
  ariaLabel,
  hideDocNav = false,
  titleSlot,
  headerActions,
}: ReaderLoadingShellProps): ReactElement {
  const prefs = readReaderPrefs(scope);
  const readerFont = resolveReaderFont(prefs.fontId);
  const style = {
    "--emr-reader-font": readerFont.stack,
    "--emr-reader-scale": String(prefs.sizePct / 100),
    "--emr-nav-scale": String(widthScale(prefs.navWidthPct)),
    "--emr-rail-scale": String(widthScale(prefs.commentWidthPct)),
  } as CSSProperties;

  return (
    <div
      className={`emr-app emr-reader-loading-shell${
        prefs.showNav && !hideDocNav ? "" : " is-nav-hidden"
      }${prefs.showComments ? "" : " is-comments-hidden"}`}
      style={style}
      role="status"
      aria-label={ariaLabel}
      aria-busy="true"
    >
      <div
        className={`emr-body-frame${hideDocNav ? " emr-body-frame--no-nav" : ""}`}
      >
        {hideDocNav ? null : (
          <div className="emr-body__nav">
            <aside className="emr-docnav" aria-label="Document navigation">
              {titleSlot || headerActions ? (
                <div className="emr-docnav-header">
                  {titleSlot}
                  {headerActions}
                </div>
              ) : null}
              <div className="emr-docnav-skel" aria-hidden="true">
                <div className="emr-skel-line emr-skel-w80" />
                <div className="emr-skel-line emr-skel-w60" />
                <div className="emr-skel-line emr-skel-w70" />
                <div className="emr-skel-line emr-skel-w50" />
                <div className="emr-skel-line emr-skel-w65" />
              </div>
            </aside>
          </div>
        )}

        <div className="emr-body">
          <div className={`emr-grid${hideDocNav ? " emr-grid--no-nav" : ""}`}>
            <div className="emr-article-wrap emr-skeleton" aria-hidden="true">
              <div className="emr-skel-line emr-skel-title" />
              <div className="emr-skel-line emr-skel-w90" />
              <div className="emr-skel-line emr-skel-w75" />
              <div className="emr-skel-line emr-skel-w85" />
              <div className="emr-skel-block" />
              <div className="emr-skel-line emr-skel-w80" />
              <div className="emr-skel-line emr-skel-w60" />
            </div>
          </div>
        </div>

        <div className="emr-rail">
          <div className="emr-rail-scroll">
            <aside className="emr-rail-col emr-skeleton" aria-hidden="true">
              <div className="emr-rail-skel-card" />
              <div className="emr-rail-skel-card" />
            </aside>
          </div>
        </div>
      </div>
      <div className="emr-loading-statusbar" aria-hidden="true" />
    </div>
  );
}
