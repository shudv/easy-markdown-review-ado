// The lazy KaTeX/Mermaid loaders accept a module namespace that exposes the
// API directly (CommonJS interop) as well as one with a `default` export. Each
// loader caches its module per instance, so the namespace-only shape needs its
// own file with its own mocks.
//
// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  katexRender: vi.fn(
    (source: string) => `<span class="katex">${source}</span>`,
  ),
  mermaidInitialize: vi.fn(),
  mermaidRender: vi.fn(async () => ({ svg: "<svg></svg>" })),
}));
vi.mock("katex", () => ({
  default: undefined,
  renderToString: mocks.katexRender,
}));
vi.mock("mermaid", () => ({
  default: undefined,
  initialize: mocks.mermaidInitialize,
  render: mocks.mermaidRender,
}));
const { katexRender, mermaidInitialize, mermaidRender } = mocks;

import { hydrateMath } from "../src/markdown/mathHydrate";
import { hydrateMermaid } from "../src/markdown/mermaidHydrate";

describe("lazy renderer loaders — namespace without a default export", () => {
  it("hydrates math through the namespace's own renderToString", async () => {
    const root = document.createElement("div");
    root.innerHTML = `<span class="emr-math" data-math-src="${encodeURIComponent("x^2")}"></span>`;

    await hydrateMath(root);

    expect(katexRender).toHaveBeenCalledWith("x^2", expect.any(Object));
    expect(root.querySelector(".katex")?.textContent).toBe("x^2");
  });

  it("hydrates diagrams through the namespace's own initialize/render", async () => {
    const root = document.createElement("div");
    root.innerHTML = `<div class="emr-mermaid" data-mermaid-src="${encodeURIComponent("graph TD\nA-->B")}"></div>`;
    document.body.appendChild(root);

    await hydrateMermaid(root);

    expect(mermaidInitialize).toHaveBeenCalledOnce();
    expect(mermaidRender).toHaveBeenCalledOnce();
    expect(
      root.querySelector(".emr-mermaid")?.getAttribute("data-hydrated"),
    ).toBe("true");
    root.remove();
  });
});
