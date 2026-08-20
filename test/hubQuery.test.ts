// Tests for the Documents hub deep-link query contract. The hub reads a target
// file out of its URL query params via `parseHubQuery` (used for externally
// shared / bookmarked deep links); these guard that the reader honours the
// required keys and normalises empty optionals.

import { describe, expect, it } from "vitest";

import { parseHubQuery } from "../src/shell/hubQuery";

describe("parseHubQuery", () => {
  it("parses a fully-populated query into a target", () => {
    expect(
      parseHubQuery({
        emrRepo: "repo-1",
        emrRepoName: "MyRepo",
        emrProj: "proj-1",
        emrPath: "/docs/design.md",
        emrVer: "GBmain",
      }),
    ).toEqual({
      repositoryId: "repo-1",
      repositoryName: "MyRepo",
      project: "proj-1",
      path: "/docs/design.md",
      version: "GBmain",
    });
  });

  it("returns null when a required key is missing", () => {
    expect(parseHubQuery({})).toBeNull();
    expect(parseHubQuery({ emrRepo: "r", emrProj: "p" })).toBeNull();
    expect(parseHubQuery({ emrRepo: "r", emrPath: "/x.md" })).toBeNull();
    expect(parseHubQuery({ emrProj: "p", emrPath: "/x.md" })).toBeNull();
  });

  it("maps empty optional values to undefined", () => {
    const config = parseHubQuery({
      emrRepo: "r",
      emrProj: "p",
      emrPath: "/x.md",
      emrRepoName: "",
      emrVer: "",
    });
    expect(config?.repositoryName).toBeUndefined();
    expect(config?.version).toBeUndefined();
  });
});
