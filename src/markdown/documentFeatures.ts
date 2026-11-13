// Which rich features a rendered document uses — counts only, for telemetry,
// so we can tell whether diagrams, equations, Excalidraw drawings and Azure
// DevOps wiki macros are worth their weight.

import { isExcalidrawPath } from "./excalidraw";

export interface DocumentFeatures {
    /** Mermaid diagrams. */
    diagrams: number;
    /** KaTeX equations (inline and display). */
    equations: number;
    /** Images that reference an Excalidraw scene. */
    drawings: number;
    /** `[[_TOC_]]` / `[[_TOSP_]]` wiki macros. */
    wikiMacros: number;
}

// A class as a whole word in a class attribute, so `emr-math` doesn't also
// count `emr-math-fallback`. `renderMarkdown` writes double-quoted attributes.
const DIAGRAM_RE = /class="(?:[^"]*\s)?emr-mermaid(?=[\s"])/g;
const EQUATION_RE = /class="(?:[^"]*\s)?emr-math(?=[\s"])/g;
const WIKI_MACRO_RE = /class="(?:[^"]*\s)?emr-wiki-macro(?=[\s"])/g;
// An image's source, up to any query or fragment.
const IMAGE_SRC_RE = /<img\b[^>]*?\ssrc="([^"?#]*)/g;

/** Count the rich features in `renderMarkdown` output. */
export function countDocumentFeatures(html: string): DocumentFeatures {
    const count = (re: RegExp) => html.match(re)?.length ?? 0;
    const sources = Array.from(html.matchAll(IMAGE_SRC_RE), (match) => match[1]!);

    return {
        diagrams: count(DIAGRAM_RE),
        equations: count(EQUATION_RE),
        drawings: sources.filter(isExcalidrawPath).length,
        wikiMacros: count(WIKI_MACRO_RE),
    };
}

/** Whether the document uses any rich feature at all. */
export function hasDocumentFeatures(features: DocumentFeatures): boolean {
    return Object.values(features).some((count) => count > 0);
}
