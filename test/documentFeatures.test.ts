// Tests for counting the rich features a rendered document uses (telemetry
// only: counts, never content).

import { describe, expect, it } from "vitest";

import { countDocumentFeatures, hasDocumentFeatures } from "../src/markdown/documentFeatures";

describe("countDocumentFeatures", () => {
    it("counts diagrams, equations, Excalidraw drawings and wiki macros", () => {
        const html = [
            '<nav class="emr-wiki-macro emr-wiki-toc"></nav>',
            '<div class="emr-mermaid" data-mermaid-src="graph TD"></div>',
            '<div class="emr-mermaid" data-mermaid-src="graph LR"></div>',
            '<span class="emr-math emr-math--inline"></span>',
            '<img src="docs/flow.excalidraw" alt="">',
            '<img src="docs/flow.excalidraw.json?v=2#top" alt="">',
            '<img src="docs/photo.png" alt="">',
        ].join("");

        expect(countDocumentFeatures(html)).toEqual({
            diagrams: 2,
            equations: 1,
            drawings: 2,
            wikiMacros: 1,
        });
    });

    it("counts a class only as a whole word, not as part of a longer one", () => {
        const html = [
            '<span class="emr-math-fallback">x</span>',
            '<div class="emr-mermaid-fallback"></div>',
            '<p class="emr-wiki-macro-note"></p>',
            '<span class="katex emr-math">x</span>',
        ].join("");

        expect(countDocumentFeatures(html)).toEqual({
            diagrams: 0,
            equations: 1,
            drawings: 0,
            wikiMacros: 0,
        });
    });

    it("reads an image's source among its other attributes", () => {
        const html = [
            '<img alt="flow" data-src="x.png" src="docs/flow.excalidraw?raw=1">',
            '<img src="">',
            '<img data-src="docs/other.excalidraw" alt="">',
        ].join("");

        expect(countDocumentFeatures(html).drawings).toBe(1);
    });

    it("finds nothing in plain prose", () => {
        const features = countDocumentFeatures("<h1>Title</h1><p>Text</p>");
        expect(features).toEqual({ diagrams: 0, equations: 0, drawings: 0, wikiMacros: 0 });
        expect(hasDocumentFeatures(features)).toBe(false);
    });

    it("says a document with any feature has features", () => {
        expect(hasDocumentFeatures({ diagrams: 0, equations: 0, drawings: 1, wikiMacros: 0 })).toBe(
            true,
        );
    });
});
