"use strict";

// Custom istanbul coverage reporter that prints ONLY what is uncovered —
// the exact source lines and branch arms with a gap — instead of the wide
// per-file percentage table. Paired with the compact `text-summary` reporter
// (totals) in vitest.config.ts.
//
// Runs during report generation, so it prints even when the run later fails
// the coverage threshold (which is exactly when you want to see the gaps).

const fs = require("fs");
const path = require("path");
const { ReportBase } = require("istanbul-lib-report");

const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const sourceCache = new Map();
function sourceLine(file, lineNo) {
  if (!sourceCache.has(file)) {
    try {
      sourceCache.set(file, fs.readFileSync(file, "utf8").split(/\r?\n/));
    } catch {
      sourceCache.set(file, null);
    }
  }
  const lines = sourceCache.get(file);
  if (!lines) return "";
  return (lines[lineNo - 1] ?? "").trim();
}

module.exports = class UncoveredCoverageReporter extends ReportBase {
  constructor(opts = {}) {
    super();
    this.cwd = opts.projectRoot || process.cwd();
    this.printed = false;
  }

  onDetail(node) {
    const fc = node.getFileCoverage();
    const file = fc.path;
    const rel = path.relative(this.cwd, file).replace(/\\/g, "/");

    // Uncovered lines.
    const lineCoverage = fc.getLineCoverage();
    const uncoveredLines = Object.keys(lineCoverage)
      .filter((ln) => lineCoverage[ln] === 0)
      .map(Number)
      .sort((a, b) => a - b);

    // Uncovered branch arms.
    const branchMap = fc.branchMap;
    const branchHits = fc.b;
    const uncoveredBranches = [];
    for (const id of Object.keys(branchMap)) {
      const arms = branchHits[id] || [];
      arms.forEach((count, i) => {
        if (count === 0) {
          const meta = branchMap[id];
          const loc = (meta.locations && meta.locations[i]) || meta.loc || {};
          const line = loc.start && loc.start.line;
          uncoveredBranches.push({ type: meta.type, arm: i, line });
        }
      });
    }

    if (uncoveredLines.length === 0 && uncoveredBranches.length === 0) return;

    if (!this.printed) {
      this.printed = true;
      process.stdout.write(
        `\n${BOLD}Uncovered details${RESET} ${DIM}(lines & branches with no coverage)${RESET}\n`,
      );
    }

    process.stdout.write(`\n${BOLD}${rel}${RESET}\n`);

    for (const ln of uncoveredLines) {
      process.stdout.write(
        `  ${RED}line ${ln}${RESET}  ${DIM}${sourceLine(file, ln)}${RESET}\n`,
      );
    }

    // Collapse branches by line so a multi-arm gap prints once per line.
    const byLine = new Map();
    for (const b of uncoveredBranches) {
      const key = b.line ?? "?";
      if (!byLine.has(key)) byLine.set(key, new Set());
      byLine.get(key).add(b.type);
    }
    for (const [line, types] of [...byLine.entries()].sort(
      (a, b) => (a[0] || 0) - (b[0] || 0),
    )) {
      const label = [...types].join(", ");
      process.stdout.write(
        `  ${YELLOW}branch ${line}${RESET} ${DIM}(${label})${RESET}  ${DIM}${sourceLine(file, line)}${RESET}\n`,
      );
    }
  }

  onEnd() {
    if (!this.printed) {
      process.stdout.write(`\n${DIM}No uncovered lines or branches.${RESET}\n`);
    }
  }
};
