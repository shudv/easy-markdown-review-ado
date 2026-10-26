// KaTeX's lazy load goes through the shared chunk retry (the retry policy
// itself is covered by the Mermaid chunk tests). Own module instance: the SUT
// caches its loader promise.
//
// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

const retried = vi.fn();
vi.mock("../src/markdown/chunkRetry", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/markdown/chunkRetry")>();
  return {
    ...actual,
    withChunkRetry: <T>(op: () => Promise<T>) => {
      retried();
      return actual.withChunkRetry(op);
    },
  };
});

vi.mock("katex", () => ({
  default: {
    renderToString: (source: string) => `<span class="katex">${source}</span>`,
  },
}));

import { hydrateMath } from "../src/markdown/mathHydrate";

describe("hydrateMath — chunk retry", () => {
  // Production: a transient "Loading chunk … failed" left equations as raw TeX.
  it("loads KaTeX through the shared chunk retry", async () => {
    const root = document.createElement("div");
    root.innerHTML = `<div class="emr-math" data-math-src="${encodeURIComponent("x^2")}"></div>`;
    document.body.appendChild(root);

    await hydrateMath(root);

    expect(retried).toHaveBeenCalledOnce();
    expect(root.querySelector<HTMLElement>(".emr-math")!.dataset.hydrated).toBe(
      "true",
    );
  });
});
