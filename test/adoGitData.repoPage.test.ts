// Tests for the picker's pure repo-projection helpers, extracted from the
// SDK-touching `adoGitData.ts` so they run without the AMD ADO bundles:
//   - `repoSkeleton`        -> content-less DocRepo for the picker
//   - `repoDescription`     -> the one-liner shown under the name
//   - `normalizeRepoFilter` -> ADO `filterContains` normalization

import { describe, expect, it } from "vitest";

import type { GitRepository } from "azure-devops-extension-api/Git";

import {
  normalizeRepoFilter,
  repoDescription,
  repoSkeleton,
} from "../src/shell/adoGitData.helpers";

function repo(over: Partial<GitRepository>): GitRepository {
  return {
    id: "id",
    name: "name",
    defaultBranch: "refs/heads/main",
    ...over,
  } as GitRepository;
}

describe("repoSkeleton", () => {
  it("projects a raw repo into a content-less, unloaded DocRepo", () => {
    const skeleton = repoSkeleton(
      repo({ id: "a", name: "alpha", defaultBranch: "refs/heads/release" }),
    );

    expect(skeleton).toMatchObject({
      id: "a",
      name: "alpha",
      defaultBranch: "release",
      files: [],
      topLevelFolders: [],
      recentPr: null,
      detailsLoaded: false,
    });
  });

  it("falls back to `main` when the default branch is missing", () => {
    const skeleton = repoSkeleton(
      repo({ id: "b", name: "bravo", defaultBranch: undefined }),
    );
    expect(skeleton.defaultBranch).toBe("main");
  });
});

describe("repoDescription", () => {
  it("summarizes the default branch", () => {
    expect(repoDescription(repo({ defaultBranch: "refs/heads/dev" }))).toBe(
      "Default branch: dev",
    );
  });

  it("falls back to `main` when absent", () => {
    expect(repoDescription(repo({ defaultBranch: undefined }))).toBe(
      "Default branch: main",
    );
  });
});

describe("normalizeRepoFilter", () => {
  it("trims a non-empty filter", () => {
    expect(normalizeRepoFilter("  pay  ")).toBe("pay");
  });

  it("maps blank/undefined to undefined (unfiltered first page)", () => {
    expect(normalizeRepoFilter("   ")).toBeUndefined();
    expect(normalizeRepoFilter("")).toBeUndefined();
    expect(normalizeRepoFilter(undefined)).toBeUndefined();
  });
});
