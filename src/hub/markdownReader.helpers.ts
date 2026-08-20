// Pure helpers extracted from `markdownReader.tsx` so they can be unit-tested
// without the `azure-devops-extension-{api,sdk}` AMD bundles. The container
// keeps the SDK enum mapping (GitVersionType/GitVersionOptions) and imports
// the parser below for the prefix-decoding decision.

/** Kind of ref an ADO version spec (`GB`/`GC`/`GT`) points at. */
export type VersionSpecKind = "branch" | "commit" | "tag";

export interface ParsedVersionSpec {
  kind: VersionSpecKind;
  value: string;
}

/**
 * Decode an ADO version spec into its `{ kind, value }` parts:
 *   - `GB<branch>` → branch
 *   - `GC<commit>` → commit
 *   - `GT<tag>`    → tag
 * Returns `null` for a missing spec, an empty value, or an unrecognised
 * prefix, so the caller falls back to the repo's default branch.
 */
export function parseVersionSpec(
  spec: string | undefined,
): ParsedVersionSpec | null {
  if (!spec) return null;
  const value = spec.slice(2);
  if (!value) return null;
  switch (spec.slice(0, 2)) {
    case "GB":
      return { kind: "branch", value };
    case "GC":
      return { kind: "commit", value };
    case "GT":
      return { kind: "tag", value };
    default:
      return null;
  }
}
