/*
 * The Azure DevOps "Files" tab, as an injectable fragment — the *before*
 * picture for the showcase: a unified Markdown diff plus ADO's Diff/Preview
 * toggle. Flipping between the two is the whole point of the opening beat:
 * the diff shows you the markup, the preview shows you the page, and neither
 * one shows you what actually changed.
 *
 * The panel sits over the story area and is driven from Node by setting
 * `#emr-ado-files[data-mode]` to "diff" or "preview".
 *
 * Content mirrors the showcase story fixture (src/shell/components/
 * PrShell.visual.stories.tsx) so the two acts read as the same document.
 *
 * Build-time asset generator only — not shipped in the extension.
 */
const FILE_NAME = "production-rollout.md";

// Unified diff of the fixture (SHOWCASE_SOURCE + SHOWCASE_DIFF in
// src/shell/components/PrShell.visual.stories.tsx). It has to state exactly the
// same three changes the review tab shows: v1 -> v2 inside a link target, the
// Web row added, the Notifications row deleted.
const DIFF = [
  ["ctx", 1, 1, "# Production Rollout"],
  ["ctx", 2, 2, ""],
  [
    "del",
    3,
    null,
    "Review the [deployment runbook](https://example.com/runbooks/deploy-v1) before using the resolved configuration.",
  ],
  [
    "add",
    null,
    3,
    "Review the [deployment runbook](https://example.com/runbooks/deploy-v2) before using the resolved configuration.",
  ],
  ["ctx", 4, 4, ""],
  ["ctx", 5, 5, "## Service Plan"],
  ["ctx", 6, 6, ""],
  ["ctx", 7, 7, "| Service | Owner    | Window    |"],
  ["ctx", 8, 8, "| ------- | -------- | --------- |"],
  ["ctx", 9, 9, "| API     | Platform | 02:00 UTC |"],
  ["del", 10, null, "| Notifications | Messaging | 05:00 UTC |"],
  ["add", null, 10, "| Web     | Frontend | 04:00 UTC |"],
  ["ctx", 11, 11, ""],
  ["ctx", 12, 12, "## Release Checks"],
  ["ctx", 13, 13, ""],
  ["ctx", 14, 14, "1. Confirm health checks in every active region."],
  ["ctx", 15, 15, "2. Publish the release summary after rollout."],
  ["ctx", 16, 16, ""],
  ["ctx", 17, 17, "## Recovery"],
  ["ctx", 18, 18, ""],
  [
    "ctx",
    19,
    19,
    "Roll back to the previous artifact if regional health checks fail.",
  ],
];

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const diffRows = () =>
  DIFF.map(([kind, oldNo, newNo, text]) => {
    const sign = kind === "add" ? "+" : kind === "del" ? "-" : " ";
    return (
      `<div class="fx-row fx-${kind}">` +
      `<span class="fx-no">${oldNo ?? ""}</span>` +
      `<span class="fx-no">${newNo ?? ""}</span>` +
      `<span class="fx-sign">${sign}</span>` +
      `<span class="fx-code">${esc(text)}</span>` +
      `</div>`
    );
  }).join("");

// ADO's Markdown preview: the head revision, rendered, with no change
// information and nowhere to anchor a comment.
const PREVIEW = `
  <h1>Production Rollout</h1>
  <p>Review the <a>deployment runbook</a> before using the resolved configuration.</p>
  <h2>Service Plan</h2>
  <table>
    <thead><tr><th>Service</th><th>Owner</th><th>Window</th></tr></thead>
    <tbody>
      <tr><td>API</td><td>Platform</td><td>02:00 UTC</td></tr>
      <tr><td>Web</td><td>Frontend</td><td>04:00 UTC</td></tr>
    </tbody>
  </table>
  <h2>Release Checks</h2>
  <ol>
    <li>Confirm health checks in every active region.</li>
    <li>Publish the release summary after rollout.</li>
  </ol>
  <h2>Recovery</h2>
  <p>Roll back to the previous artifact if regional health checks fail.</p>`;

// Returns { css, html }. Inject `css` via addStyleTag and append `html` to body.
export function adoFilesMarkup({ left, top, width, height }) {
  const css = `
  #emr-ado-files {
    position: fixed; left: ${left}px; top: ${top}px; width: ${width}px; height: ${height}px;
    z-index: 55; display: none; background: #fff; overflow: hidden;
    font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    color: #242424; -webkit-font-smoothing: antialiased;
    border-top: 1px solid #edebe9;
  }
  #emr-ado-files[data-mode] { display: flex; }
  #emr-ado-files * { box-sizing: border-box; }

  #emr-ado-files .fx-tree {
    width: 300px; flex: none; border-right: 1px solid #edebe9; background: #faf9f8;
    padding: 14px 0; font-size: 13.5px; color: #323130;
  }
  #emr-ado-files .fx-tree-head {
    padding: 0 16px 12px; font-size: 12px; font-weight: 600; letter-spacing: .4px;
    text-transform: uppercase; color: #605e5c;
  }
  #emr-ado-files .fx-tree-row {
    display: flex; align-items: center; gap: 8px; padding: 7px 16px; color: #605e5c;
  }
  #emr-ado-files .fx-tree-row.sel { background: #deecf9; color: #201f1e; font-weight: 600; }
  #emr-ado-files .fx-md { color: #0b6cc9; font-size: 12px; }
  #emr-ado-files .fx-chip {
    margin-left: auto; font-size: 11px; font-weight: 600; color: #605e5c;
    background: #edebe9; border-radius: 10px; padding: 1px 8px;
  }

  #emr-ado-files .fx-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  #emr-ado-files .fx-bar {
    height: 46px; flex: none; display: flex; align-items: center; gap: 12px;
    padding: 0 18px; border-bottom: 1px solid #edebe9; background: #faf9f8;
  }
  #emr-ado-files .fx-path { font-size: 14px; font-weight: 600; }
  #emr-ado-files .fx-meta { font-size: 12.5px; color: #605e5c; }
  #emr-ado-files .fx-toggle {
    margin-left: auto; display: flex; border: 1px solid #c8c6c4; border-radius: 3px;
    overflow: hidden; background: #fff;
  }
  #emr-ado-files .fx-toggle > div {
    padding: 0 18px; height: 30px; display: flex; align-items: center;
    font-size: 13px; font-weight: 600; color: #323130;
  }
  #emr-ado-files .fx-toggle > div + div { border-left: 1px solid #e1dfdd; }
  #emr-ado-files[data-mode="diff"] .fx-opt-diff,
  #emr-ado-files[data-mode="preview"] .fx-opt-preview { background: #0078d4; color: #fff; }

  #emr-ado-files .fx-body { flex: 1; min-height: 0; overflow: hidden; }
  #emr-ado-files[data-mode="diff"] .fx-preview,
  #emr-ado-files[data-mode="preview"] .fx-diff { display: none; }

  #emr-ado-files .fx-diff { padding: 10px 0; }
  #emr-ado-files .fx-hunk {
    display: flex; gap: 10px; padding: 4px 18px; background: #f3f2f1; color: #605e5c;
    font: 12.5px/1.5 "Cascadia Mono", Consolas, "Courier New", monospace;
    border-top: 1px solid #edebe9; border-bottom: 1px solid #edebe9; margin-bottom: 6px;
  }
  #emr-ado-files .fx-row {
    display: flex; align-items: flex-start;
    font: 13.5px/1.62 "Cascadia Mono", Consolas, "Courier New", monospace;
    white-space: pre;
  }
  #emr-ado-files .fx-no {
    width: 52px; flex: none; text-align: right; padding-right: 12px;
    color: #a19f9d; user-select: none;
  }
  #emr-ado-files .fx-sign { width: 22px; flex: none; text-align: center; color: #8a8886; }
  #emr-ado-files .fx-code { flex: 1; min-width: 0; padding-right: 18px; overflow: hidden; }
  #emr-ado-files .fx-add { background: #e6ffec; }
  #emr-ado-files .fx-add .fx-sign { color: #1a7f37; }
  #emr-ado-files .fx-del { background: #ffebe9; }
  #emr-ado-files .fx-del .fx-sign { color: #cf222e; }

  #emr-ado-files .fx-preview { padding: 26px 48px; font-size: 15px; line-height: 1.6; color: #24292f; }
  #emr-ado-files .fx-preview h1 { font-size: 30px; font-weight: 600; margin: 0 0 16px; padding-bottom: 8px; border-bottom: 1px solid #d8dee4; }
  #emr-ado-files .fx-preview h2 { font-size: 21px; font-weight: 600; margin: 22px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #d8dee4; }
  #emr-ado-files .fx-preview p { margin: 0 0 12px; }
  #emr-ado-files .fx-preview a { color: #0969da; text-decoration: none; }
  #emr-ado-files .fx-preview table { border-collapse: collapse; margin: 0 0 12px; }
  #emr-ado-files .fx-preview th, #emr-ado-files .fx-preview td { border: 1px solid #d0d7de; padding: 6px 14px; text-align: left; }
  #emr-ado-files .fx-preview th { background: #f6f8fa; font-weight: 600; }
  #emr-ado-files .fx-preview ol { margin: 0 0 12px; padding-left: 26px; }
  #emr-ado-files .fx-preview li { margin-bottom: 5px; }
  `;

  const html = `
    <div class="fx-tree">
      <div class="fx-tree-head">Files</div>
      <div class="fx-tree-row sel"><span class="fx-md">M&darr;</span>${FILE_NAME}<span class="fx-chip">+2 -2</span></div>
      <div class="fx-tree-row"><span class="fx-md">M&darr;</span>README.md</div>
      <div class="fx-tree-row"><span class="fx-md">M&darr;</span>CHANGELOG.md</div>
    </div>
    <div class="fx-main">
      <div class="fx-bar">
        <span class="fx-path">${FILE_NAME}</span>
        <span class="fx-meta">Modified</span>
        <div class="fx-toggle"><div class="fx-opt-diff">Diff</div><div class="fx-opt-preview">Preview</div></div>
      </div>
      <div class="fx-body">
        <div class="fx-diff">
          <div class="fx-hunk">@@ -1,20 +1,20 @@</div>
          ${diffRows()}
        </div>
        <div class="fx-preview">${PREVIEW}</div>
      </div>
    </div>`;

  return { css, html };
}
