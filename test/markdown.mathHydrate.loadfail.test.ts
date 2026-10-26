// Isolated test for the KaTeX library-load failure path. The shared
// `katexPromise` cache inside the SUT means a load failure can only be
// exercised in a module instance where the dynamic `import("katex")` is
// rigged to reject — so this lives in its own file with its own mock.
//
// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";

let loadAttempts = 0;
// Reject the first load, then resolve, so the retry is observable.
vi.mock("katex", () => {
  loadAttempts += 1;
  if (loadAttempts === 1) throw new Error("chunk load failed");
  return {
    default: {
      renderToString: (source: string) =>
        `<span class="katex">${source}</span>`,
    },
  };
});

import { hydrateMath } from "../src/markdown/mathHydrate";

const trackUserFacingErrorMock = vi.fn();
vi.mock("../src/telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/telemetry")>();
  return {
    ...actual,
    trackUserFacingError: (...args: unknown[]) =>
      trackUserFacingErrorMock(...args),
  };
});

describe("hydrateMath — library load failure", () => {
  it("flags the placeholder, then recovers on a later pass", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = document.createElement("div");
    root.innerHTML =
      `<div class="emr-math" data-math-src="${encodeURIComponent("x^2")}">` +
      `<pre class="emr-math-fallback"><code>x^2</code></pre></div>`;
    document.body.appendChild(root);
    const element = root.querySelector<HTMLElement>(".emr-math")!;

    await expect(hydrateMath(root)).resolves.toBeUndefined();
    expect(element.dataset.mathError).toBe("load-failed");
    // Not hydrated — the fallback stays readable and eligible for a retry.
    expect(element.dataset.hydrated).toBeUndefined();
    expect(trackUserFacingErrorMock).toHaveBeenCalledOnce();
    expect(trackUserFacingErrorMock).toHaveBeenCalledWith({
      error: expect.anything(),
      source: "Math.hydrate",
      operation: "math-library-load",
      impact: "degraded",
    });

    // The rejected loader promise must not stay cached, or every later pass
    // would fail without ever re-attempting the chunk.
    await hydrateMath(root);
    expect(loadAttempts).toBeGreaterThan(1);
    expect(element.dataset.hydrated).toBe("true");
    expect(element.dataset.mathError).toBeUndefined();
    expect(element.querySelector(".katex")).not.toBeNull();

    // ...but once it succeeds the promise is cached again, so a further pass
    // reuses it rather than re-importing the chunk.
    const attemptsAfterRecovery = loadAttempts;
    root.insertAdjacentHTML(
      "beforeend",
      `<span class="emr-math" data-math-src="${encodeURIComponent("y^2")}"></span>`,
    );
    await hydrateMath(root);
    expect(loadAttempts).toBe(attemptsAfterRecovery);
    expect(
      root.querySelectorAll('.emr-math[data-hydrated="true"]'),
    ).toHaveLength(2);

    warn.mockRestore();
  });
});
