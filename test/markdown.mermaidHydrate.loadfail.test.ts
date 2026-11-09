// Isolated test for the mermaid library-load failure path. The shared
// `mermaidPromise` cache inside the SUT means a load failure can only be
// exercised in a module instance where the dynamic `import("mermaid")` is
// rigged to reject — so this lives in its own file with its own mock.
//
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

// Make the dynamic import reject by throwing from the mock factory.
vi.mock("mermaid", () => {
    throw new Error("chunk load failed");
});

import { hydrateMermaid } from "../src/markdown/mermaidHydrate";
import { recordTelemetryEachTest } from "./telemetrySink";

const telemetry = recordTelemetryEachTest();

describe("hydrateMermaid — library load failure", () => {
    beforeEach(() => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("keeps every diagram's source readable, flags it as load-failed, and reports once", async () => {
        const root = document.createElement("div");
        const src = encodeURIComponent("graph TD\nA-->B");
        root.innerHTML =
            `<div class="emr-mermaid" data-mermaid-src="${src}"><pre class="emr-mermaid-fallback">graph TD</pre></div>` +
            `<div class="emr-mermaid" data-mermaid-src="${src}"><pre class="emr-mermaid-fallback">graph TD</pre></div>`;
        document.body.appendChild(root);

        await hydrateMermaid(root);

        const diagrams = Array.from(root.querySelectorAll(".emr-mermaid"), (el) => ({
            error: el.getAttribute("data-mermaid-error"),
            hydrated: el.getAttribute("data-hydrated"),
            fallback: el.querySelector(".emr-mermaid-fallback") !== null,
        }));

        expect(diagrams).toEqual([
            { error: "load-failed", hydrated: null, fallback: true },
            { error: "load-failed", hydrated: null, fallback: true },
        ]);
        expect(telemetry.current.userFacingErrors()).toEqual([
            expect.objectContaining({
                error: expect.objectContaining({
                    cause: expect.objectContaining({ message: "chunk load failed" }),
                }),
                source: "Mermaid.hydrate",
                operation: "diagram-library-load",
                impact: "degraded",
            }),
        ]);
    });
});
