// Isolated tests for a failed KaTeX chunk load. The SUT caches its loader
// promise per module instance, so the failure must happen in a module instance
// where the dynamic `import("katex")` is rigged to reject — hence this file.
//
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import { hydrateMath } from "../src/markdown/mathHydrate";
import { recordTelemetryEachTest } from "./telemetrySink";

const katex = vi.hoisted(() => ({ available: false, loads: 0 }));

vi.mock("katex", () => {
    katex.loads += 1;
    if (!katex.available) throw new Error("chunk load failed");

    return {
        default: {
            renderToString: (source: string) => `<span class="katex">${source}</span>`,
        },
    };
});

const telemetry = recordTelemetryEachTest();

function mountEquation(source: string): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML =
        `<div class="emr-math" data-math-src="${encodeURIComponent(source)}">` +
        `<pre class="emr-math-fallback"><code>${source}</code></pre></div>`;
    document.body.appendChild(root);

    return root;
}

describe("hydrateMath — KaTeX chunk fails to load", () => {
    beforeEach(() => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // Runs first: KaTeX must not have loaded yet in this module instance.
    it("keeps the equation's source readable, flags it, and reports the degraded rendering", async () => {
        const root = mountEquation("x^2");
        const equation = root.querySelector<HTMLElement>(".emr-math")!;

        await hydrateMath(root);

        expect(equation.dataset.mathError).toBe("load-failed");
        expect(equation.dataset.hydrated).toBeUndefined();
        expect(equation.querySelector(".emr-math-fallback")?.textContent).toBe("x^2");
        expect(telemetry.current.userFacingErrors()).toEqual([
            expect.objectContaining({
                source: "Math.hydrate",
                operation: "math-library-load",
                impact: "degraded",
            }),
        ]);
    });

    it("renders the equation on a later pass once the chunk loads", async () => {
        katex.available = true;
        const root = mountEquation("y^2");
        const equation = root.querySelector<HTMLElement>(".emr-math")!;
        equation.dataset.mathError = "load-failed";

        await hydrateMath(root);

        expect(equation.dataset.hydrated).toBe("true");
        expect(equation.dataset.mathError).toBeUndefined();
        expect(equation.querySelector(".katex")).not.toBeNull();
    });

    it("downloads KaTeX only once for later passes after it has loaded", async () => {
        katex.available = true;
        await hydrateMath(mountEquation("a^2"));
        const loadsAfterFirstRender = katex.loads;

        await hydrateMath(mountEquation("b^2"));

        expect(katex.loads).toBe(loadsAfterFirstRender);
    });
});
