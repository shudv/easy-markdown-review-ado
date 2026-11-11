// A short JSON list kept under one localStorage key — the shape of this
// browser's caches (recent documents, recent PRs). One key means one write:
// it either replaces the whole list or leaves the old one, never half of it.
// Best-effort: missing, blocked, full or corrupt storage reads as an empty
// list, and a write that can't be made is skipped.

/** The list stored under `key`, keeping only items `isItem` accepts. */
export function readStoredList<T>(key: string, isItem: (value: unknown) => value is T): T[] {
    try {
        const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");

        return Array.isArray(parsed) ? parsed.filter(isItem) : [];
    } catch {
        return [];
    }
}

/** Store `items` under `key`, replacing the list there. Quiet on failure. */
export function writeStoredList(key: string, items: readonly unknown[]): void {
    try {
        window.localStorage.setItem(key, JSON.stringify(items));
    } catch {
        /* storage blocked or full: the cache just isn't updated */
    }
}

/** A non-null object, for `isItem` checks. */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
