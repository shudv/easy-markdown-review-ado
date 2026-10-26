import { describe, it, expect } from "vitest";

// @ts-expect-error -- untyped release script (plain ESM)
import { classifyVersion } from "../scripts/verify-marketplace-version.mjs";

// The verdict that decides whether the publish pipeline's verify_marketplace
// job passes: validated → green, a validation message → red, else keep polling.
describe("classifyVersion", () => {
  const gallery = (...versions: object[]) => ({ versions });

  it("passes a validated version", () => {
    expect(
      classifyVersion(
        gallery({ version: "1.2", flags: "validated, signed" }),
        "1.2",
      ).state,
    ).toBe("validated");
  });

  it("fails a version the Marketplace rejected, with its message", () => {
    expect(
      classifyVersion(
        gallery({
          version: "1.2",
          flags: "none",
          validationResultMessage: " Manifest invalid ",
        }),
        "1.2",
      ),
    ).toEqual({ state: "rejected", detail: "Manifest invalid" });
  });

  it("keeps waiting while the version is unlisted or still validating", () => {
    expect(classifyVersion(gallery({ version: "1.1" }), "1.2").state).toBe(
      "pending",
    );
    expect(classifyVersion(undefined, "1.2").state).toBe("pending");
    expect(classifyVersion(gallery({ version: "1.2" }), "1.2")).toEqual({
      state: "pending",
      detail: "flags=none",
    });
  });
});
