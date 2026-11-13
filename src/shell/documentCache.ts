// Recently read documents, kept in this browser so reopening one — in the PR
// tab or the Documents hub — renders without fetching it again.
//
// Documents are kept by git blob id: the hash of the content itself, so an
// entry is never stale (a changed document is a different blob), and one entry
// serves every commit, branch and pull request where a document reads the
// same. It holds the most recently fetched few; caching is best-effort and
// never fails or changes a read (see `storedList.ts`).

import { noteBootCache } from "../telemetry";
import { isRecord, readStoredList, writeStoredList } from "./storedList";

/** The localStorage key holding the cached documents, newest first. */
export const DOC_CACHE_KEY = "emr.docs.v1";
/** How many documents are kept. */
export const MAX_CACHED_DOCS = 10;
/**
 * A document whose stored form (JSON, so newlines, quotes and backslashes
 * count twice) is longer than this, in characters, isn't cached. With
 * `MAX_CACHED_DOCS` it bounds the cache at 1M characters of the ~5M a
 * browser gives this origin's localStorage.
 */
export const MAX_CACHED_DOC_CHARS = 100_000;

interface CachedDoc {
    id: string;
    content: string;
}

/**
 * The content of git blob `objectId`: from the cache when it holds it,
 * otherwise `load`ed — which must read exactly that blob — and cached.
 */
export async function readThroughDocCache(
    objectId: string,
    load: () => Promise<string>,
): Promise<string> {
    // PR changes report blob ids in upper case, folder listings in lower case.
    const id = objectId.toLowerCase();
    const hit = readDocs().find((doc) => doc.id === id);

    if (hit) {
        noteBootCache("doc", true);

        return hit.content;
    }

    const content = await load();
    const entry: CachedDoc = { id, content };

    if (JSON.stringify(entry).length <= MAX_CACHED_DOC_CHARS) {
        const others = readDocs().filter((doc) => doc.id !== id);
        writeStoredList(DOC_CACHE_KEY, [entry, ...others].slice(0, MAX_CACHED_DOCS));
    }

    return content;
}

function readDocs(): CachedDoc[] {
    return readStoredList(DOC_CACHE_KEY, isCachedDoc);
}

function isCachedDoc(value: unknown): value is CachedDoc {
    return isRecord(value) && typeof value.id === "string" && typeof value.content === "string";
}
