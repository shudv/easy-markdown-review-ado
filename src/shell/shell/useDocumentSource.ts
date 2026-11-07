// Shell: loading and rendering the selected document.

import { useEffect, useRef, useState } from "react";

import { renderMarkdown } from "../../markdown/render";
import { markAppReady, trackUserFacingError } from "../../telemetry";
import { errorMessage, isItemNotFoundError } from "../shellHelpers";

type MissingDocOutcome = "replaced" | "expected" | "unexpected";

/**
 * The selected document's Markdown source and rendered HTML (cached per file),
 * its load/error state, and the boot-time "content ready" signal.
 */
export function useDocumentSource(
    selectedPath: string,
    loadFileSource: (path: string) => Promise<string>,
) {
    // Per-file rendered HTML cache.
    const [htmlByPath, setHtmlByPath] = useState<Record<string, string>>({});

    // Per-file committed Markdown source cache; used to anchor comments against
    // the exact source that produced the rendered article.
    const [sourceByPath, setSourceByPath] = useState<Record<string, string>>({});

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Documents hub: a remembered or linked document that's no longer in the
    // repo (renamed / deleted) was swapped for another one; tell the reader.
    const [missingDoc, setMissingDoc] = useState<{
        missing: string;
        shown: string;
    } | null>(null);

    // Decides what a "not found" document load means — re-assigned after every
    // commit (by `useDocNavigation`, which owns the deep-link refs it resets), so
    // the load effect's async failure path can call it without depending on the
    // file list.
    const handleMissingDocRef = useRef<(missing: string) => MissingDocOutcome>(null!);

    const [renderVersion, setRenderVersion] = useState(0);

    useEffect(() => {
        if (!selectedPath) return;

        if (htmlByPath[selectedPath]) {
            // A cache hit shows the cached document, so drop any error or spinner
            // left over from a file that failed or was still loading.
            // eslint-disable-next-line react-hooks/set-state-in-effect -- a cache hit must clear the previous file's spinner/error and bump renderVersion (which deep-link consumers key on) in the same pass as the load branch below; deriving them would change that cadence.
            setLoading(false);
            setError(null);
            setRenderVersion((v) => v + 1);

            return;
        }

        let cancelled = false;
        setLoading(true);
        setError(null);
        loadFileSource(selectedPath)
            .then(async (source) => {
                if (cancelled) return;
                const html = await renderMarkdown(source);
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the effect cleanup can cancel during the awaited render; TS wrongly keeps the narrowing from the pre-await check.
                if (cancelled) return;
                setSourceByPath((prev) => ({
                    ...prev,
                    [selectedPath]: source,
                }));
                setHtmlByPath((prev) => ({ ...prev, [selectedPath]: html }));
                setLoading(false);
                setRenderVersion((v) => v + 1);
            })
            .catch((err: unknown) => {
                if (cancelled) return;

                const missing = isItemNotFoundError(err)
                    ? handleMissingDocRef.current(selectedPath)
                    : "unexpected";

                if (missing === "replaced") return;

                if (missing === "unexpected") {
                    trackUserFacingError({
                        error: err,
                        source: "Shell.documentLoad",
                        operation: "document-load",
                        impact: "blocking",
                    });
                }

                setError(errorMessage(err));
                setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [selectedPath, loadFileSource, htmlByPath]);

    useBootReadySignal(htmlByPath, selectedPath, error);

    return {
        htmlByPath,
        sourceByPath,
        loading,
        setLoading,
        error,
        missingDoc,
        setMissingDoc,
        handleMissingDocRef,
        renderVersion,
    };
}

// Boot-time signal: the experience is "loaded" the moment the first
// document's Markdown has been committed to the DOM — not when React first
// mounted. Boot completes on the TERMINAL outcome of the first document's
// content load: success ("content") OR a load/render failure ("error").
// Gating only on success would silently drop the boot event whenever the
// first file can't be fetched or rendered, so the dependent (boot completion)
// deterministically awaits the actual settle of the content fetch rather than
// assuming content will always appear. Fires once (markAppReady is idempotent
// + no-ops outside a real boot, e.g. Storybook). Runs in an effect so it
// lands after commit/paint.
function useBootReadySignal(
    htmlByPath: Record<string, string>,
    selectedPath: string,
    error: string | null,
): void {
    const bootReadyFiredRef = useRef(false);
    useEffect(() => {
        if (bootReadyFiredRef.current) return;

        const hasRenderedHtmlForSelected =
            !!selectedPath && Object.prototype.hasOwnProperty.call(htmlByPath, selectedPath);

        if (hasRenderedHtmlForSelected) {
            bootReadyFiredRef.current = true;
            markAppReady("content");
        } else if (error !== null && error !== "") {
            bootReadyFiredRef.current = true;
            markAppReady("error");
        }
    }, [htmlByPath, selectedPath, error]);
}
