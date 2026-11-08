// Retry for webpack's lazy-chunk loads (Mermaid, KaTeX). A `ChunkLoadError` is
// usually a transient network/CDN blip; webpack forgets a failed chunk, so a
// retry really re-fetches it. Anything else rethrows at once.

const CHUNK_RETRY_DELAYS_MS = [1_000, 3_000] as const;

/** True for webpack's lazy-chunk fetch failure (`ChunkLoadError`). */
export function isChunkLoadError(err: unknown): boolean {
    if (typeof err !== "object" || err === null) return false;
    const { name, message } = err as { name?: unknown; message?: unknown };

    return (
        name === "ChunkLoadError" ||
        // Stryker disable next-line ConditionalExpression: dead code: RegExp#test stringifies a non-string message ("undefined", "42", …) and no such text contains "Loading chunk", so the typeof check never changes the result — it only narrows the type; candidate for removal (e.g. test String(message)).
        (typeof message === "string" && /\bLoading (?:CSS )?chunk\b/.test(message))
    );
}

/**
 * Run `op`, retrying a transient `ChunkLoadError` after each of
 * `CHUNK_RETRY_DELAYS_MS`. Anything else — including a diagram syntax error —
 * rethrows at once.
 */
export async function withChunkRetry<T>(op: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await op();
        } catch (err) {
            if (attempt >= CHUNK_RETRY_DELAYS_MS.length || !isChunkLoadError(err)) {
                throw err;
            }

            const delayMs = CHUNK_RETRY_DELAYS_MS[attempt];
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
}
