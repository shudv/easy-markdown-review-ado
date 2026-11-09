// Simulates browser storage that refuses access — private browsing, a full
// quota, or storage disabled by policy — for the reader's persistence tests.
// Callers restore it with `vi.restoreAllMocks()`.

import { vi } from "vitest";

export type StorageMethod = "getItem" | "setItem" | "removeItem";

/** Make every `localStorage` / `sessionStorage` `method` call throw. */
export function failStorage(method: StorageMethod): void {
    vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new DOMException("Storage is unavailable", "QuotaExceededError");
    });
}
