// Complexity report + ratchet for production source (src/, excluding stories
// and type declarations).
//
// Scores come from two established ESLint rules, so the numbers match what the
// editor shows:
//   * cyclomatic — ESLint core `complexity` (independent paths through a function)
//   * cognitive  — SonarSource `sonarjs/cognitive-complexity` (how hard it reads;
//                  nesting is penalised)
//
// The gate works like the coverage/mutation thresholds, but per function:
// `complexity-baseline.json` holds the limits for new code plus every existing
// function that already exceeds them, pinned at its current score. The check
// fails when
//   1. a function not in the baseline exceeds a limit,
//   2. a grandfathered function gets worse than its pinned score, or
//   3. the baseline is stale (a pinned function improved, was renamed, or was
//      removed) — so improvements are locked in and can never silently regress.
//
// Usage:
//   node scripts/check-complexity.mjs                    # report (never fails)
//   node scripts/check-complexity.mjs --json             # report as JSON
//   node scripts/check-complexity.mjs --check            # CI gate
//   node scripts/check-complexity.mjs --update           # tighten baseline only
//   node scripts/check-complexity.mjs --update --accept  # also pin regressions /
//                                                        # new offenders (reviewable)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const BASELINE_PATH = resolve(repoRoot, "complexity-baseline.json");

export const METRICS = ["cyclomatic", "cognitive"];
const SOURCE_GLOBS = ["src/**/*.{ts,tsx}"];
const SOURCE_IGNORES = ["src/**/*.stories.tsx", "src/**/*.d.ts"];

// Wrappers that don't change which function a node "is", e.g.
// `const f = (() => {}) as Handler` or `const f = memo(function Inner() {})`.
const TRANSPARENT_PARENTS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "ChainExpression",
]);

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

function keyName(key, computed) {
  if (!computed && key.type === "Identifier") return key.name;
  if (key.type === "PrivateIdentifier") return `#${key.name}`;
  if (key.type === "Literal") return String(key.value);
  return "[computed]";
}

function calleeName(callee) {
  switch (callee.type) {
    case "Identifier":
      return callee.name;
    case "MemberExpression":
      return `${calleeName(callee.object)}.${keyName(callee.property, callee.computed)}`;
    case "CallExpression":
      return `${calleeName(callee.callee)}()`;
    case "ThisExpression":
      return "this";
    default:
      return "<expr>";
  }
}

function jsxName(name) {
  if (name.type === "JSXNamespacedName")
    return `${name.namespace.name}:${name.name.name}`;
  return name.name;
}

/** Skip transparent wrappers; returns [effectiveChild, effectiveParent]. */
function unwrap(node) {
  let child = node;
  let parent = node.parent;
  while (parent && TRANSPARENT_PARENTS.has(parent.type)) {
    child = parent;
    parent = parent.parent;
  }
  return [child, parent];
}

/** Human-readable, line-number-free name for a function or class node. */
export function describeNode(node, sourceCode) {
  if (node.id?.name) return node.id.name;
  const [child, parent] = unwrap(node);
  if (!parent) return "<anonymous>";
  switch (parent.type) {
    case "VariableDeclarator":
      return parent.id.type === "Identifier"
        ? parent.id.name
        : "<destructured>";
    case "MethodDefinition":
    case "TSAbstractMethodDefinition":
    case "Property":
    case "PropertyDefinition": {
      const name = keyName(parent.key, parent.computed);
      return parent.kind === "get" || parent.kind === "set"
        ? `${parent.kind} ${name}`
        : name;
    }
    case "AssignmentExpression":
    case "AssignmentPattern":
      return sourceCode.getText(parent.left);
    case "CallExpression":
    case "NewExpression": {
      // `const onSave = useCallback(() => …)` is better known as `onSave`.
      const [, holder] = unwrap(parent);
      if (
        holder?.type === "VariableDeclarator" &&
        holder.id.type === "Identifier" &&
        parent.arguments[0] === child
      ) {
        return holder.id.name;
      }
      return `${calleeName(parent.callee)}(callback)`;
    }
    case "JSXExpressionContainer":
      return parent.parent?.type === "JSXAttribute"
        ? `${jsxName(parent.parent.name)} handler`
        : "<jsx callback>";
    case "ExportDefaultDeclaration":
      return "default export";
    case "ReturnStatement":
    case "ArrowFunctionExpression":
      return "returned function";
    default:
      return "<anonymous>";
  }
}

/**
 * ESLint rule that reports nothing; it records the qualified name and source
 * span of every function so scores can be attributed to stable identities.
 */
function createNameCollector(store) {
  return {
    meta: { type: "suggestion", schema: [] },
    create(context) {
      const sourceCode = context.sourceCode;
      const functions = [];
      store.set(context.filename, functions);
      const indexOf = (line, column) =>
        sourceCode.getIndexFromLoc({ line, column: column - 1 });
      const qualify = (node) =>
        sourceCode
          .getAncestors(node)
          .filter(
            (a) =>
              FUNCTION_TYPES.has(a.type) ||
              a.type === "ClassDeclaration" ||
              a.type === "ClassExpression",
          )
          .map((a) => describeNode(a, sourceCode))
          .join(" > ");
      const visit = (node) => {
        const path = qualify(node);
        // Rules report methods at their key, which sits on the parent node.
        const [, parent] = unwrap(node);
        const owner =
          parent &&
          (parent.type === "MethodDefinition" ||
            parent.type === "TSAbstractMethodDefinition" ||
            parent.type === "PropertyDefinition" ||
            (parent.type === "Property" && parent.value === node))
            ? parent
            : node;
        functions.push({
          name: [path, describeNode(node, sourceCode)]
            .filter(Boolean)
            .join(" > "),
          line: node.loc.start.line,
          start: owner.range[0],
          end: owner.range[1],
          indexOf,
        });
      };
      return {
        FunctionDeclaration: visit,
        FunctionExpression: visit,
        ArrowFunctionExpression: visit,
        // ESLint's `complexity` also scores these as their own code paths.
        PropertyDefinition(node) {
          if (!node.value || FUNCTION_TYPES.has(node.value.type)) return;
          functions.push({
            name: `${qualify(node)} > ${keyName(node.key, node.computed)} initializer`,
            line: node.value.loc.start.line,
            start: node.value.range[0],
            end: node.value.range[1],
            indexOf,
          });
        },
        StaticBlock(node) {
          functions.push({
            name: `${qualify(node)} > static block`,
            line: node.loc.start.line,
            start: node.range[0],
            end: node.range[1],
            indexOf,
          });
        },
      };
    },
  };
}

/** Disambiguate same-named functions in a file by source order (#2, #3, …). */
export function assignKeys(functions) {
  const seen = new Map();
  for (const fn of [...functions].sort((a, b) => a.start - b.start)) {
    const n = (seen.get(fn.name) ?? 0) + 1;
    seen.set(fn.name, n);
    fn.key = n === 1 ? fn.name : `${fn.name} #${n}`;
  }
  return functions;
}

/** Lint the production source and return one record per function. */
export async function measure({
  cwd = repoRoot,
  patterns = SOURCE_GLOBS,
} = {}) {
  const { ESLint } = await import("eslint");
  const { default: tseslint } = await import("typescript-eslint");
  const { default: sonarjs } = await import("eslint-plugin-sonarjs");
  const names = new Map();
  const eslint = new ESLint({
    cwd,
    overrideConfigFile: true,
    allowInlineConfig: false,
    overrideConfig: [
      { ignores: SOURCE_IGNORES },
      {
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        plugins: {
          sonarjs,
          emr: { rules: { names: createNameCollector(names) } },
        },
        // A limit of 0 makes every function report its score.
        rules: {
          complexity: ["error", { max: 0 }],
          "sonarjs/cognitive-complexity": ["error", 0],
          "emr/names": "error",
        },
      },
    ],
  });
  const results = await eslint.lintFiles(patterns);

  const records = [];
  for (const result of results) {
    const fatal = result.messages.filter((m) => m.fatal || !m.ruleId);
    if (fatal.length) {
      throw new Error(
        `Failed to parse ${result.filePath}: ${fatal.map((m) => m.message).join("; ")}`,
      );
    }
    const functions = assignKeys(names.get(result.filePath) ?? []);
    const file = relative(cwd, result.filePath).replaceAll("\\", "/");
    const byKey = new Map(
      functions.map((fn) => [
        fn.key,
        { file, name: fn.key, line: fn.line, cyclomatic: 0, cognitive: 0 },
      ]),
    );
    for (const message of result.messages) {
      const metric =
        message.ruleId === "complexity"
          ? "cyclomatic"
          : message.ruleId === "sonarjs/cognitive-complexity"
            ? "cognitive"
            : null;
      if (!metric) continue;
      const score = Number(
        (metric === "cyclomatic"
          ? /complexity of (\d+)/
          : /from (\d+) to/
        ).exec(message.message)?.[1],
      );
      const at = functions[0]?.indexOf(message.line, message.column) ?? -1;
      // Innermost function whose span contains the report position.
      const owner = functions
        .filter((fn) => fn.start <= at && at < fn.end)
        .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
      if (!owner || Number.isNaN(score)) {
        throw new Error(
          `Could not attribute ${message.ruleId} at ${file}:${message.line}:${message.column}`,
        );
      }
      const record = byKey.get(owner.key);
      record[metric] = Math.max(record[metric], score);
    }
    records.push(...byKey.values());
  }
  return records.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
  );
}

export const recordKey = (record) => `${record.file}::${record.name}`;

/** Compare measurements to the baseline. Pure, so it is unit-testable. */
export function evaluate(records, baseline) {
  const { limits, functions: pinned } = baseline;
  const violations = [];
  const stale = [];
  const seen = new Set();
  for (const record of records) {
    const key = recordKey(record);
    const entry = pinned[key];
    if (entry) seen.add(key);
    for (const metric of METRICS) {
      const actual = record[metric];
      const pinnedScore = entry?.[metric];
      const allowed = Math.max(limits[metric], pinnedScore ?? 0);
      if (actual > allowed) {
        violations.push({
          key,
          metric,
          actual,
          allowed,
          pinned: pinnedScore !== undefined,
        });
      } else if (pinnedScore !== undefined && actual < pinnedScore) {
        stale.push({ key, metric, actual, pinned: pinnedScore });
      }
    }
  }
  for (const key of Object.keys(pinned)) {
    if (!seen.has(key))
      stale.push({ key, metric: null, actual: null, pinned: null });
  }
  return { violations, stale };
}

/**
 * Build the next baseline. Without `accept`, scores can only go down and new
 * offenders are never added (they stay violations).
 */
export function nextBaseline(records, baseline, { accept = false } = {}) {
  const { limits, functions: pinned } = baseline;
  const functions = {};
  for (const record of records) {
    const key = recordKey(record);
    const entry = {};
    for (const metric of METRICS) {
      const actual = record[metric];
      if (actual <= limits[metric]) continue;
      const previous = pinned[key]?.[metric];
      if (accept) entry[metric] = actual;
      else if (previous !== undefined)
        entry[metric] = Math.min(previous, actual);
    }
    if (Object.keys(entry).length) functions[key] = entry;
  }
  const sorted = Object.fromEntries(
    Object.keys(functions)
      .sort()
      .map((key) => [key, functions[key]]),
  );
  return { ...baseline, functions: sorted };
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  ];
}

export function summarize(records, limits) {
  const stats = {};
  for (const metric of METRICS) {
    const values = records.map((r) => r[metric]);
    stats[metric] = {
      mean: Number(
        (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2),
      ),
      median: percentile(values, 50),
      p90: percentile(values, 90),
      p99: percentile(values, 99),
      max: Math.max(...values),
      overLimit: values.filter((v) => v > limits[metric]).length,
    };
  }
  return {
    files: new Set(records.map((r) => r.file)).size,
    functions: records.length,
    ...stats,
  };
}

function printReport(records, baseline) {
  const summary = summarize(records, baseline.limits);
  console.log(
    `\nComplexity — ${summary.functions} functions in ${summary.files} files with functions` +
      ` (limits: cyclomatic ${baseline.limits.cyclomatic}, cognitive ${baseline.limits.cognitive})\n`,
  );
  console.table(
    Object.fromEntries(
      METRICS.map((m) => [
        m,
        {
          mean: summary[m].mean,
          median: summary[m].median,
          p90: summary[m].p90,
          p99: summary[m].p99,
          max: summary[m].max,
          "over limit": summary[m].overLimit,
        },
      ]),
    ),
  );
  console.log("\nMost complex functions (by cognitive, then cyclomatic):");
  console.table(
    [...records]
      .sort((a, b) => b.cognitive - a.cognitive || b.cyclomatic - a.cyclomatic)
      .slice(0, 15)
      .map((r) => ({
        function: r.name.length > 50 ? `${r.name.slice(0, 47)}...` : r.name,
        location: `${r.file}:${r.line}`,
        cyclomatic: r.cyclomatic,
        cognitive: r.cognitive,
      })),
  );
}

function printGate({ violations, stale }) {
  for (const v of violations) {
    console.error(
      v.pinned
        ? `✗ ${v.key}: ${v.metric} ${v.actual} exceeds its pinned ${v.allowed}`
        : `✗ ${v.key}: ${v.metric} ${v.actual} exceeds the limit of ${v.allowed}`,
    );
  }
  for (const s of stale) {
    console.error(
      s.metric
        ? `↓ ${s.key}: ${s.metric} improved ${s.pinned} → ${s.actual}; lock it in`
        : `↓ ${s.key}: pinned function no longer exists (removed or renamed)`,
    );
  }
  if (violations.length) {
    console.error(
      "\nSplit the function or simplify its branching. If the increase is" +
        " deliberate, pin it with `npm run complexity:update -- --accept` so it is" +
        " visible in review.",
    );
  }
  if (stale.length) {
    console.error(
      "\nThe baseline can be tightened. Run `npm run complexity:update` and commit" +
        " complexity-baseline.json.",
    );
  }
}

function readBaseline() {
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
}

function writeBaseline(baseline) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
}

async function main(argv) {
  const baseline = readBaseline();
  const records = await measure();

  if (argv.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          summary: summarize(records, baseline.limits),
          gate: evaluate(records, baseline),
          functions: records,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (argv.includes("--update")) {
    const next = nextBaseline(records, baseline, {
      accept: argv.includes("--accept"),
    });
    writeBaseline(next);
    const before = Object.keys(baseline.functions).length;
    const after = Object.keys(next.functions).length;
    console.log(
      `complexity-baseline.json updated: ${before} → ${after} pinned functions.`,
    );
    const { violations } = evaluate(records, next);
    if (violations.length) {
      printGate({ violations, stale: [] });
      return 1;
    }
    return 0;
  }

  const gate = evaluate(records, baseline);
  if (argv.includes("--check")) {
    const summary = summarize(records, baseline.limits);
    if (!gate.violations.length && !gate.stale.length) {
      console.log(
        `✓ Complexity within budget: ${summary.functions} functions, ` +
          `${Object.keys(baseline.functions).length} pinned above the limits ` +
          `(cyclomatic ${baseline.limits.cyclomatic}, cognitive ${baseline.limits.cognitive}).`,
      );
      return 0;
    }
    printGate(gate);
    return 1;
  }

  printReport(records, baseline);
  const status =
    gate.violations.length || gate.stale.length
      ? `${gate.violations.length} violation(s), ${gate.stale.length} stale baseline entr(ies) — run with --check for details.`
      : "Gate: passing.";
  console.log(`\n${status}`);
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error);
      process.exit(2);
    },
  );
}
