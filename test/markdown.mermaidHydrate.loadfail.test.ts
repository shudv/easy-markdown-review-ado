// Isolated test for the mermaid library-load failure path. The shared
// `mermaidPromise` cache inside the SUT means a load failure can only be
// exercised in a module instance where the dynamic `import("mermaid")` is
// rigged to reject — so this lives in its own file with its own mock.
//
// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";

// Make the dynamic import reject by throwing from the mock factory.
vi.mock("mermaid", () => {
  throw new Error("chunk load failed");
});

import { hydrateMermaid } from "../src/markdown/mermaidHydrate";

const trackUserFacingErrorMock = vi.fn();
vi.mock("../src/telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/telemetry")>();
  return {
    ...actual,
    trackUserFacingError: (...args: unknown[]) =>
      trackUserFacingErrorMock(...args),
  };
});

describe("hydrateMermaid — library load failure", () => {
  it("flags every placeholder as load-failed without throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = document.createElement("div");
    const src = encodeURIComponent("graph TD\nA-->B");
    root.innerHTML =
      `<div class="emr-mermaid" data-mermaid-src="${src}"></div>` +
      `<div class="emr-mermaid" data-mermaid-src="${src}"></div>`;
    document.body.appendChild(root);

    await expect(hydrateMermaid(root)).resolves.toBeUndefined();

    for (const el of root.querySelectorAll(".emr-mermaid")) {
      expect(el.getAttribute("data-mermaid-error")).toBe("load-failed");
      // Not hydrated — the fallback stays in place for a retry/readability.
      expect(el.getAttribute("data-hydrated")).toBeNull();
    }
    expect(trackUserFacingErrorMock).toHaveBeenCalledOnce();
    expect(trackUserFacingErrorMock).toHaveBeenCalledWith({
      error: expect.objectContaining({
        message: expect.stringContaining("error when mocking a module"),
        cause: expect.objectContaining({ message: "chunk load failed" }),
      }),
      source: "Mermaid.hydrate",
      operation: "diagram-library-load",
      impact: "degraded",
    });
    warn.mockRestore();
  });
});
