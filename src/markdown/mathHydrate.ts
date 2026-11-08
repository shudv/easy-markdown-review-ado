// Browser-side KaTeX hydration.
//
// Markdown rendering emits inert `.emr-math` placeholders with readable source
// fallbacks. KaTeX and its fonts are loaded only when a rendered surface
// contains math, keeping the normal reader startup bundle lean.

import { trackUserFacingError } from "../telemetry";
import { withChunkRetry } from "./chunkRetry";

type KatexApi = {
    renderToString: (
        source: string,
        options: {
            displayMode: boolean;
            throwOnError: boolean;
            trust: boolean;
            strict: "warn";
            maxExpand: number;
            maxSize: number;
        },
    ) => string;
};

let katexPromise: Promise<KatexApi> | null = null;

function getKatex(): Promise<KatexApi> {
    // Stryker disable next-line ConditionalExpression: the module system already caches the dynamic imports, so building a fresh promise per pass resolves to the same API.
    if (katexPromise) return katexPromise;
    katexPromise = (async () => {
        // A transient chunk-load failure (flaky network, CDN blip) is retried,
        // as for Mermaid.
        const [mod] = await withChunkRetry(() =>
            Promise.all([
                import(/* webpackChunkName: "katex" */ "katex"),
                import(/* webpackChunkName: "katex" */ "katex/dist/katex.min.css"),
            ]),
        );

        // A CommonJS-interop namespace exposes the API without a `default`.
        return (mod as { default?: KatexApi }).default ?? (mod as KatexApi);
    })().catch((error: unknown) => {
        // Drop the rejected promise so a later pass (a theme redraw, a re-render)
        // can retry instead of being stuck with the first chunk-load failure.
        katexPromise = null;
        throw error;
    });

    return katexPromise;
}

export async function hydrateMath(
    root: HTMLElement,
    loadKatex: () => Promise<KatexApi> = getKatex,
): Promise<void> {
    const placeholders = Array.from(
        root.querySelectorAll<HTMLElement>(".emr-math[data-math-src]"),
    ).filter((element) => element.dataset.hydrated !== "true");

    if (placeholders.length === 0) return;

    let katex: KatexApi;

    try {
        katex = await loadKatex();
    } catch (error) {
        for (const element of placeholders) {
            element.dataset.mathError = "load-failed";
        }

        // Stryker disable next-line StringLiteral: developer-console text only; the reader-facing state and telemetry don't depend on it.
        console.warn("[math] failed to load KaTeX:", error);
        trackUserFacingError({
            error,
            source: "Math.hydrate",
            operation: "math-library-load",
            impact: "degraded",
        });

        return;
    }

    for (const element of placeholders) {
        const encoded = element.dataset.mathSrc;
        // An empty `data-math-src` has nothing to render; keep its fallback.
        // Stryker disable next-line ConditionalExpression: dead code: placeholders are selected with `[data-math-src]`, so the attribute is never missing (undefined) here; candidate for removal (the check only narrows the type).
        if (encoded === undefined || encoded === "") continue;
        let source: string;

        try {
            source = decodeURIComponent(encoded);
        } catch {
            element.dataset.mathError = "invalid-source";
            continue;
        }

        try {
            const html = katex.renderToString(source, {
                displayMode: element.dataset.mathDisplay === "true",
                throwOnError: true,
                trust: false,
                // Stryker disable next-line StringLiteral: `strict` only decides whether KaTeX logs a console warning for non-standard LaTeX; a falsy value ("ignore") renders identical markup.
                strict: "warn",
                maxExpand: 1000,
                maxSize: 20,
            });

            element.removeAttribute("data-math-error");
            element.dataset.hydrated = "true";
            const template = document.createElement("template");
            // eslint-disable-next-line no-unsanitized/property -- KaTeX renderToString with trust: false escapes all source text and refuses \href/\url/\html* commands, so its markup is inert
            template.innerHTML = html;

            const fallback = element.querySelector(":scope > .emr-math-fallback");

            if (fallback) fallback.replaceWith(template.content);
            else element.appendChild(template.content);
        } catch {
            // Invalid author input is content health, not an application reliability
            // failure. Keep the source fallback visible and mark it for styling.
            element.dataset.hydrated = "true";
            element.dataset.mathError = "render-failed";
        }
    }
}
