// Once-per-streak reporting for operations that repeat on every keystroke or
// poll. A failing typeahead (e.g. a Work Item search timing out server-side)
// used to report each keystroke — 42 identical reports from 3 sessions in one
// week. The first failure after a success (or ever) reports; the rest of the
// streak stays quiet until the operation succeeds again.

export class FailureStreaks {
    private readonly failing = new Set<string>();

    /** Record a failure; true when it starts a new streak (report it). */
    fail(key: string): boolean {
        if (this.failing.has(key)) return false;
        this.failing.add(key);

        return true;
    }

    /** Record a success, ending the key's streak. */
    succeed(key: string): void {
        this.failing.delete(key);
    }
}
