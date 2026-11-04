import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { evaluate, measure, nextBaseline } from "./check-complexity.mjs";

async function measureFixture(files) {
  const root = await mkdtemp(join(tmpdir(), "emr-complexity-"));
  try {
    for (const [name, source] of Object.entries(files)) {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src", name), source);
    }
    const { functions } = await measure({ cwd: root });
    return Object.fromEntries(
      functions.map((r) => [`${r.file}::${r.name}`, r]),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const limits = {
  cyclomatic: 20,
  cognitive: 15,
  lines: 80,
  params: 4,
  fileLines: 500,
};
const record = (name, cyclomatic, cognitive, lines = 1, params = 0) => ({
  file: "src/a.ts",
  name,
  line: 1,
  cyclomatic,
  cognitive,
  lines,
  params,
});
// Function records only, as `measure()` returns them alongside file records.
const fns = (...records) => ({ functions: records, files: [] });

test("scores each function with ESLint complexity and SonarJS cognitive complexity", async () => {
  const byKey = await measureFixture({
    "a.ts": [
      "export function branchy(a: number) {",
      "  if (a > 1) {",
      "    for (const x of [a]) {",
      "      if (x) return 1;",
      "    }",
      "  } else if (a < 0) {",
      "    return 2;",
      "  }",
      "  return a ? 3 : 4;",
      "}",
      "export const flat = () => 1;",
    ].join("\n"),
  });
  assert.deepEqual(
    {
      c: byKey["src/a.ts::branchy"].cyclomatic,
      g: byKey["src/a.ts::branchy"].cognitive,
    },
    // cyclomatic: 1 + if + for + if + else-if + ternary
    // cognitive: if(1) + for(2, nested) + if(3, nested twice) + else-if(1) + ternary(1)
    { c: 6, g: 8 },
  );
  assert.deepEqual(
    {
      c: byKey["src/a.ts::flat"].cyclomatic,
      g: byKey["src/a.ts::flat"].cognitive,
    },
    { c: 1, g: 0 },
  );
});

test("attributes a nested function's branches to the nested function, not its parent", async () => {
  const byKey = await measureFixture({
    "a.ts": [
      "export function outer(xs: number[]) {",
      "  return xs.map((x) => {",
      "    if (x > 1) return 1;",
      "    if (x > 2) return 2;",
      "    return 3;",
      "  });",
      "}",
    ].join("\n"),
  });
  assert.equal(byKey["src/a.ts::outer"].cyclomatic, 1);
  assert.equal(byKey["src/a.ts::outer > xs.map(callback)"].cyclomatic, 3);
});

test("names functions by stable, line-number-free identities", async () => {
  const byKey = await measureFixture({
    "a.tsx": [
      "import { useCallback, useEffect } from 'react';",
      "export function Panel() {",
      "  const onSave = useCallback(() => 1, []);",
      "  useEffect(() => {}, []);",
      "  useEffect(() => {}, []);",
      "  return <button onClick={() => onSave()} />;",
      "}",
      "export class Store {",
      "  count = 0;",
      "  get size() { return this.count; }",
      "  add = (n: number) => { this.count += n; };",
      "  static { void 0; }",
      "}",
      "export const api = { load() { return 1; } };",
      "export default function () { return 1; }",
    ].join("\n"),
  });
  assert.deepEqual(Object.keys(byKey).sort(), [
    "src/a.tsx::Panel",
    "src/a.tsx::Panel > onClick handler",
    "src/a.tsx::Panel > onSave",
    "src/a.tsx::Panel > useEffect(callback)",
    "src/a.tsx::Panel > useEffect(callback) #2",
    "src/a.tsx::Store > add",
    "src/a.tsx::Store > count initializer",
    "src/a.tsx::Store > get size",
    "src/a.tsx::Store > static block",
    "src/a.tsx::default export",
    "src/a.tsx::load",
  ]);
});

test("ignores Storybook stories and type declarations", async () => {
  const byKey = await measureFixture({
    "a.ts": "export const a = () => 1;",
    "a.stories.tsx": "export const Story = () => 1;",
    "types.d.ts": "declare function f(): void;",
  });
  assert.deepEqual(Object.keys(byKey), ["src/a.ts::a"]);
});

test("passes when functions are within limits or at their pinned score", () => {
  const baseline = {
    limits,
    functions: { "src/a.ts::big": { cyclomatic: 40, reason: "legacy parser" } },
  };
  const result = evaluate(
    fns(record("small", 20, 15), record("big", 40, 10)),
    baseline,
  );
  assert.deepEqual(result, { violations: [], stale: [], undocumented: [] });
});

test("fails a new function that exceeds a limit", () => {
  const { violations } = evaluate(fns(record("fresh", 21, 16)), {
    limits,
    functions: {},
  });
  assert.deepEqual(
    violations.map((v) => [v.metric, v.actual, v.allowed, v.pinned]),
    [
      ["cyclomatic", 21, 20, false],
      ["cognitive", 16, 15, false],
    ],
  );
});

test("fails a pinned function that gets worse, including a metric that was within the limit", () => {
  const baseline = {
    limits,
    functions: { "src/a.ts::big": { cyclomatic: 40 } },
  };
  const { violations } = evaluate(fns(record("big", 41, 16)), baseline);
  assert.deepEqual(
    violations.map((v) => [v.metric, v.actual, v.allowed, v.pinned]),
    [
      ["cyclomatic", 41, 40, true],
      ["cognitive", 16, 15, false],
    ],
  );
});

test("flags improved and missing pinned functions as stale so gains are locked in", () => {
  const baseline = {
    limits,
    functions: {
      "src/a.ts::big": { cyclomatic: 40 },
      "src/a.ts::gone": { cognitive: 30 },
    },
  };
  const { violations, stale } = evaluate(fns(record("big", 35, 1)), baseline);
  assert.deepEqual(violations, []);
  assert.deepEqual(
    stale.map((s) => [s.key, s.metric, s.actual, s.pinned]),
    [
      ["src/a.ts::big", "cyclomatic", 35, 40],
      ["src/a.ts::gone", null, null, null],
    ],
  );
});

test("update only tightens: lowers, drops resolved entries, never adds or raises", () => {
  const baseline = {
    limits,
    functions: {
      "src/a.ts::lower": { cyclomatic: 40, reason: "kept on update" },
      "src/a.ts::resolved": { cognitive: 30, reason: "dropped with the entry" },
      "src/a.ts::worse": { cyclomatic: 30 },
    },
  };
  const records = [
    record("lower", 35, 1),
    record("resolved", 1, 15),
    record("worse", 31, 1),
    record("fresh", 25, 1),
  ];
  const next = nextBaseline(fns(...records), baseline);
  assert.deepEqual(next.functions, {
    "src/a.ts::lower": { cyclomatic: 35, reason: "kept on update" },
    "src/a.ts::worse": { cyclomatic: 30 },
  });
  assert.deepEqual(
    evaluate(fns(...records), next).violations.map((v) => v.key),
    ["src/a.ts::worse", "src/a.ts::fresh"],
  );
});

test("update --accept pins current scores, including regressions and new offenders", () => {
  const baseline = {
    limits,
    functions: { "src/a.ts::worse": { cyclomatic: 30 } },
  };
  const records = [record("worse", 31, 1), record("fresh", 25, 16)];
  const next = nextBaseline(fns(...records), baseline, { accept: true });
  assert.deepEqual(next.functions, {
    "src/a.ts::fresh": { cyclomatic: 25, cognitive: 16 },
    "src/a.ts::worse": { cyclomatic: 31 },
  });
  // Newly pinned entries have no reason yet, so the check still fails on them.
  assert.deepEqual(evaluate(fns(...records), next), {
    violations: [],
    stale: [],
    undocumented: ["src/a.ts::fresh", "src/a.ts::worse"],
  });
});

test("measures code lines and declared parameters per function, and code lines per file", async () => {
  const root = await mkdtemp(join(tmpdir(), "emr-complexity-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "src", "a.ts"),
      [
        "// header comment",
        "export function wide(a: number, b: number, c: number, d: number, e: number) {",
        "  // comment lines and blank lines are not counted",
        "",
        "  return a + b + c + d + e;",
        "}",
        "export function bound(this: Window, a: number) {",
        "  return a;",
        "}",
        "export type Handler = (a: number, b: number, c: number, d: number, e: number) => void;",
      ].join("\n"),
    );
    const { functions, files } = await measure({ cwd: root });
    const byName = Object.fromEntries(functions.map((r) => [r.name, r]));
    assert.deepEqual(Object.keys(byName).sort(), ["bound", "wide"]);
    assert.deepEqual(
      { lines: byName.wide.lines, params: byName.wide.params },
      { lines: 3, params: 5 },
    );
    // A TypeScript `this` annotation is not a parameter.
    assert.equal(byName.bound.params, 1);
    assert.deepEqual(files, [{ file: "src/a.ts", fileLines: 7 }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails long functions and functions with too many parameters", () => {
  const { violations } = evaluate(fns(record("long", 1, 1, 81, 5)), {
    limits,
    functions: {},
  });
  assert.deepEqual(
    violations.map((v) => [v.metric, v.actual, v.allowed]),
    [
      ["lines", 81, 80],
      ["params", 5, 4],
    ],
  );
});

test("ratchets file length like function scores", () => {
  const baseline = {
    limits,
    functions: {},
    files: {
      "src/big.ts": { fileLines: 900 },
      "src/gone.ts": { fileLines: 700 },
    },
  };
  const measurement = {
    functions: [],
    files: [
      { file: "src/big.ts", fileLines: 850 },
      { file: "src/fresh.ts", fileLines: 501 },
      { file: "src/small.ts", fileLines: 20 },
    ],
  };
  const { violations, stale } = evaluate(measurement, baseline);
  assert.deepEqual(
    violations.map((v) => [v.key, v.metric, v.actual, v.allowed, v.pinned]),
    [["src/fresh.ts", "fileLines", 501, 500, false]],
  );
  assert.deepEqual(
    stale.map((s) => [s.key, s.metric, s.actual, s.pinned]),
    [
      ["src/big.ts", "fileLines", 850, 900],
      ["src/gone.ts", null, null, null],
    ],
  );
  assert.deepEqual(nextBaseline(measurement, baseline).files, {
    "src/big.ts": { fileLines: 850 },
  });
  assert.deepEqual(
    nextBaseline(measurement, baseline, { accept: true }).files,
    {
      "src/big.ts": { fileLines: 850 },
      "src/fresh.ts": { fileLines: 501 },
    },
  );
});

test("rejects a baseline with a missing limit instead of silently passing", () => {
  assert.throws(
    () =>
      evaluate(fns(record("a", 1, 1)), {
        limits: { cyclomatic: 20, cognitive: 15 },
        functions: {},
      }),
    /limits are missing: lines, params, fileLines/,
  );
});

test("fails pinned functions and files that don't document a reason", () => {
  const { undocumented } = evaluate(
    {
      functions: [record("big", 30, 1)],
      files: [{ file: "src/a.ts", fileLines: 600 }],
    },
    {
      limits,
      functions: { "src/a.ts::big": { cyclomatic: 30, reason: "  " } },
      files: { "src/a.ts": { fileLines: 600 } },
    },
  );
  assert.deepEqual(undocumented, ["src/a.ts::big", "src/a.ts"]);
});
