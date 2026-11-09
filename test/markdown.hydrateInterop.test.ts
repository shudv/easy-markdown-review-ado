// The lazy KaTeX/Mermaid loaders accept a module namespace that exposes the
// API directly (CommonJS interop) as well as one with a `default` export. Each
// loader caches its module per instance, so the namespace-only shape needs its
// own file with its own mocks.
//
// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

vi.mock("katex", () => ({
    default: undefined,
    renderToString: (source: string) => `<span class="katex">${source}</span>`,
}));
vi.mock("mermaid", () => ({
    default: undefined,
    initialize: () => {},
    render: async () => ({ svg: '<svg class="interop-diagram"></svg>' }),
}));

import { hydrateMath } from "../src/markdown/mathHydrate";
import { hydrateMermaid } from "../src/markdown/mermaidHydrate";

describe("lazy renderer loaders — namespace without a default export", () => {
    it("renders math with a KaTeX build that has no default export", async () => {
        const root = document.createElement("div");
        root.innerHTML = `<span class="emr-math" data-math-src="${encodeURIComponent("x^2")}"></span>`;

        await hydrateMath(root);

        expect(root.querySelector(".katex")?.textContent).toBe("x^2");
    });

    it("renders diagrams with a Mermaid build that has no default export", async () => {
        const root = document.createElement("div");
        root.innerHTML = `<div class="emr-mermaid" data-mermaid-src="${encodeURIComponent("graph TD\nA-->B")}"></div>`;
        document.body.appendChild(root);

        await hydrateMermaid(root);

        const diagram = root.querySelector(".emr-mermaid")!;
        expect(diagram.querySelector("svg.interop-diagram")).not.toBeNull();
        expect(diagram.getAttribute("data-hydrated")).toBe("true");
        root.remove();
    });
});
