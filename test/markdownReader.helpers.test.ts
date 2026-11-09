import { describe, it, expect } from "vitest";

import { parseVersionSpec } from "../src/hub/markdownReader.helpers";

describe("parseVersionSpec", () => {
    it.each([
        { name: "a GB branch spec", spec: "GBmain", expected: { kind: "branch", value: "main" } },
        {
            name: "a branch with slashes (feature/foo)",
            spec: "GBfeature/foo",
            expected: { kind: "branch", value: "feature/foo" },
        },
        {
            name: "a GC commit spec",
            spec: "GCabc123",
            expected: { kind: "commit", value: "abc123" },
        },
        { name: "a GT tag spec", spec: "GTv1.0", expected: { kind: "tag", value: "v1.0" } },
    ])("decodes $name", ({ spec, expected }) => {
        expect(parseVersionSpec(spec)).toEqual(expected);
    });

    it.each([
        { name: "there is no version in the URL", spec: undefined },
        { name: "the version is empty", spec: "" },
        { name: "the prefix carries no value", spec: "GB" },
        { name: "the prefix is not recognised", spec: "XYmain" },
    ])("returns null (use the default branch) when $name", ({ spec }) => {
        expect(parseVersionSpec(spec)).toBeNull();
    });
});
