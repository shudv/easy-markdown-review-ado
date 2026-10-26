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
    (typeof message === "string" && /\bLoading (CSS )?chunk\b/.test(message))
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
      const delayMs = CHUNK_RETRY_DELAYS_MS[attempt];
      if (delayMs === undefined || !isChunkLoadError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
