// Ambient module declaration so TypeScript treats imports of *.md files as
// string contents. Webpack's `asset/source` rule actually produces the string
// at build time. This declaration is the type-system counterpart.

declare module "*.md" {
  const content: string;
  export default content;
}

// `import css from "…/foo.css?raw"` is wired in webpack.config.cjs to return
// the CSS file's raw text (via `asset/source`). Used to swap GitHub markdown
// light/dark stylesheets at runtime — see src/theme/markdownStyles.ts.
declare module "*.css?raw" {
  const content: string;
  export default content;
}

// Build-time telemetry config, injected by webpack DefinePlugin (see
// webpack.config.cjs). Absent in tests / Storybook / standalone dev — code
// that reads it must guard with `typeof __EMR_TELEMETRY_CONFIG__ !== "undefined"`.
// Typed as a partial because the injected JSON may omit optional fields.
declare const __EMR_TELEMETRY_CONFIG__:
  | Partial<import("./telemetry/buildConfig").TelemetryBuildConfig>
  | undefined;
