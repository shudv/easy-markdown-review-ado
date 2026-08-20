/**
 * dependency-cruiser rules — architecture guardrail.
 *
 * Codifies the src/ layering so it can't erode: feature layers (comments,
 * markdown, editing) must not reach "up" into host/container layers (shell,
 * hub, pr-tab), and nothing may create a circular import. These are
 * deterministic, diff-local checks an agent can optimise against.
 *
 * Severity note: `error` rules gate; `warn` rules are the visible ratchet
 * backlog (same philosophy as the ESLint warnings) — tighten to `error` once
 * a layer's existing crossings are cleaned up.
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment:
        "Circular imports make modules impossible to reason about in isolation and break tree-shaking.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      comment:
        "Modules with no incoming or outgoing dependency edges are usually dead — surface them.",
      severity: "warn",
      from: {
        orphan: true,
        pathNot: [
          "\\.d\\.ts$",
          "(^|/)tsconfig\\.[^/]+$",
          "\\.stories\\.tsx$",
          "(^|/)globals\\.d\\.ts$",
        ],
      },
      to: {},
    },
    {
      name: "markdown-stays-pure",
      comment:
        "The markdown render pipeline is pure prose→HTML. It must not depend on the ADO/host layers (shell, hub, pr-tab, editing) or telemetry.",
      severity: "error",
      from: { path: "^src/markdown/" },
      to: { path: "^src/(shell|hub|pr-tab|editing)/" },
    },
    {
      name: "comments-not-into-containers",
      comment:
        "The comments domain must not import the app containers (hub, pr-tab). Shared types belong in src/types.ts or a shell helper.",
      severity: "warn",
      from: { path: "^src/comments/" },
      to: { path: "^src/(hub|pr-tab)/" },
    },
    {
      name: "no-test-imports-in-src",
      comment: "Product code must never import test or fixture-only helpers.",
      severity: "error",
      from: { path: "^src/", pathNot: "\\.stories\\.tsx$" },
      to: { path: "(^|/)(test|__tests__|__mocks__)/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
