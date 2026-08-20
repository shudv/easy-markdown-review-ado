import { describe, it, expect } from "vitest";

import { parseVersionSpec } from "../src/hub/markdownReader.helpers";

describe("parseVersionSpec", () => {
  it("decodes a GB branch spec", () => {
    expect(parseVersionSpec("GBmain")).toEqual({
      kind: "branch",
      value: "main",
    });
  });

  it("decodes a GC commit spec", () => {
    expect(parseVersionSpec("GCabc123")).toEqual({
      kind: "commit",
      value: "abc123",
    });
  });

  it("decodes a GT tag spec", () => {
    expect(parseVersionSpec("GTv1.0")).toEqual({ kind: "tag", value: "v1.0" });
  });

  it("keeps slashes in a branch value (feature/foo)", () => {
    expect(parseVersionSpec("GBfeature/foo")).toEqual({
      kind: "branch",
      value: "feature/foo",
    });
  });

  it("returns null for a missing spec", () => {
    expect(parseVersionSpec(undefined)).toBeNull();
    expect(parseVersionSpec("")).toBeNull();
  });

  it("returns null when the prefix carries no value", () => {
    expect(parseVersionSpec("GB")).toBeNull();
  });

  it("returns null for an unrecognised prefix", () => {
    expect(parseVersionSpec("XYmain")).toBeNull();
  });
});
