/*
 * Azure DevOps pull-request "window chrome" for the showcase, as an INJECTABLE
 * fragment (CSS + HTML) that is added directly into the story document — no
 * iframe. (A same-origin iframe composites in its own layer, so a translucent
 * dimming overlay drawn over it barely shows; injecting into one document lets
 * the spotlight dim everything uniformly.)
 *
 * Faithfully re-creates the real ADO PR header + tab strip (matched against a
 * live instance): the big PR title with Approve / Complete actions, the status
 * line (Active · !id · author proposes to merge <branch> into main · N/N
 * comments resolved), and the tab strip with "Markdown Review" active.
 *
 * Build-time asset generator only — not shipped in the extension.
 */
const BRANCH_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.492 2.492 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25ZM4.25 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm7.5-9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/></svg>';
const COPY_ICON =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M3.5 10.5h-1a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v1"/></svg>';

// Returns { css, html }. Inject `css` via addStyleTag and append `html` to body.
// The chrome is a fixed bar of `chromeHeight` px at the top; the story content
// is shifted below it by the caller's layout CSS.
export function adoChromeMarkup({ width, chromeHeight }) {
  const css = `
  #emr-ado-chrome {
    position: fixed; top: 0; left: 0; width: ${width}px; height: ${chromeHeight}px;
    background: #fff; z-index: 60; overflow: hidden;
    font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    color: #242424; -webkit-font-smoothing: antialiased;
  }
  #emr-ado-chrome * { box-sizing: border-box; }
  #emr-ado-chrome .ado-prhead {
    height: 106px; padding: 16px 26px 0; display: flex; flex-direction: column;
  }
  #emr-ado-chrome .ado-toprow { display: flex; align-items: flex-start; gap: 16px; }
  #emr-ado-chrome .ado-prtitle {
    font-size: 26px; font-weight: 600; color: #1b1b1b; line-height: 1.15;
    letter-spacing: -0.2px; flex: 1; min-width: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  #emr-ado-chrome .ado-actions { display: flex; align-items: center; gap: 8px; flex: none; }
  #emr-ado-chrome .btn {
    height: 32px; border-radius: 3px; font-size: 14px; font-weight: 600;
    display: flex; align-items: center; border: 1px solid transparent;
  }
  #emr-ado-chrome .btn .lbl { padding: 0 10px; display: flex; align-items: center; gap: 7px; }
  #emr-ado-chrome .btn .caret {
    padding: 0 8px; font-size: 10px; opacity: .85; align-self: stretch;
    display: flex; align-items: center; border-left: 1px solid rgba(0,0,0,0.12);
  }
  #emr-ado-chrome .btn-approve { background: #f5f5f5; border-color: #c4cbd2; color: #242424; }
  #emr-ado-chrome .btn-approve .caret { border-left-color: #d4d9df; }
  #emr-ado-chrome .btn-complete { background: #0b6cc9; color: #fff; }
  #emr-ado-chrome .btn-complete .caret { border-left-color: rgba(255,255,255,0.35); }
  #emr-ado-chrome .btn-more {
    width: 32px; justify-content: center; background: #f5f5f5; border-color: #c4cbd2;
    color: #57606a; font-size: 18px; line-height: 1;
  }
  #emr-ado-chrome .ado-statusrow {
    display: flex; align-items: center; gap: 9px; margin-top: 14px;
    font-size: 13px; color: #4a5158; white-space: nowrap;
  }
  #emr-ado-chrome .ado-badge {
    background: #0b6cc9; color: #fff; font-size: 12px; font-weight: 600;
    border-radius: 3px; padding: 2px 9px; letter-spacing: .2px;
  }
  #emr-ado-chrome .ado-prid { color: #6a737d; font-weight: 600; }
  #emr-ado-chrome .ado-avatar {
    width: 22px; height: 22px; border-radius: 999px; background: #3a9d5d;
    color: #fff; display: inline-flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: 700;
  }
  #emr-ado-chrome .ado-statusrow a { color: #0067b8; text-decoration: none; }
  #emr-ado-chrome .ado-statusrow .who { color: #242424; }
  #emr-ado-chrome .ado-copy { color: #8a9099; display: inline-flex; vertical-align: middle; }
  #emr-ado-chrome .ado-resolved { color: #6a737d; }
  #emr-ado-chrome .ado-tabs {
    height: 44px; display: flex; align-items: stretch; gap: 2px; padding: 0 22px;
    border-bottom: 1px solid #e6e6e6; background: #fff;
  }
  #emr-ado-chrome .ado-tab {
    display: flex; align-items: center; padding: 0 15px; font-size: 14px;
    color: #57606a; border-bottom: 2px solid transparent; position: relative; top: 1px;
  }
  #emr-ado-chrome .ado-tab.active { color: #0b6cc9; font-weight: 600; border-bottom-color: #0b6cc9; }
  `;

  const html = `
    <div class="ado-prhead">
      <div class="ado-toprow">
        <div class="ado-prtitle">Rework the widget guide</div>
        <div class="ado-actions">
          <div class="btn btn-approve"><span class="lbl">Approve</span><span class="caret">&#9662;</span></div>
          <div class="btn btn-complete"><span class="lbl">${BRANCH_ICON} Complete</span><span class="caret">&#9662;</span></div>
          <div class="btn btn-more">&#8942;</div>
        </div>
      </div>
      <div class="ado-statusrow">
        <span class="ado-badge">Active</span>
        <span class="ado-prid">!128</span>
        <span class="ado-avatar">SD</span>
        <span class="who">Shubham Dwivedi</span>
        <span>proposes to merge</span>
        <a>users/shubhd/widget-guide</a>
        <span class="ado-copy">${COPY_ICON}</span>
        <span>into</span>
        <a>main</a>
        <span class="ado-resolved">&nbsp;&middot;&nbsp;3/3 comments resolved</span>
      </div>
    </div>
    <div class="ado-tabs">
      <div class="ado-tab">Overview</div>
      <div class="ado-tab">Files</div>
      <div class="ado-tab">Updates</div>
      <div class="ado-tab">Commits</div>
      <div class="ado-tab active">Markdown Review</div>
    </div>`;

  return { css, html };
}
