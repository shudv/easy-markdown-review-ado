// KaTeX's lazy load goes through the shared chunk retry (the retry policy
// itself is covered by the Mermaid chunk tests). Own module instance: the SUT
// caches its loader promise.
//
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A first chunk request that fails the way webpack reports a network blip.
// (A throwing `vi.mock` factory can't stand in for it: vitest wraps that error,
// so it no longer looks like a ChunkLoadError.)
vi.mock("../src/markdown/chunkRetry", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/markdown/chunkRetry")>();
    let failedOnce = false;

    return {
        ...actual,
        withChunkRetry: <T>(op: () => Promise<T>) =>
            actual.withChunkRetry(async () => {
                if (failedOnce) return op();
                failedOnce = true;
                throw Object.assign(new Error("Loading chunk 77 failed."), {
                    name: "ChunkLoadError",
                });
            }),
    };
});

vi.mock("katex", () => ({
    default: {
        renderToString: (source: string) => `<span class="katex">${source}</span>`,
    },
}));

import { hydrateMath } from "../src/markdown/mathHydrate";

describe("hydrateMath — transient chunk failure", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // Production: a transient "Loading chunk … failed" left equations as raw TeX.
    it("renders the equation once a retried KaTeX chunk load succeeds", async () => {
        const root = document.createElement("div");
        root.innerHTML = `<div class="emr-math" data-math-src="${encodeURIComponent("x^2")}"></div>`;
        document.body.appendChild(root);

        const pass = hydrateMath(root);
        await vi.advanceTimersByTimeAsync(1_000);
        await pass;

        const equation = root.querySelector<HTMLElement>(".emr-math")!;
        expect(equation.dataset.mathError).toBeUndefined();
        expect(equation.querySelector(".katex")?.textContent).toBe("x^2");
    });
});
