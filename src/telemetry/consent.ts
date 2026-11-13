// The user's "Send usage data" choice, persisted in the extension origin's
// localStorage so the PR tab and the Documents hub share it. On by default;
// telemetry reads it before sending anything, including at boot.

export const USAGE_DATA_STORAGE_KEY = "emr.usageData";

/** Whether the user allows usage data (true unless they turned it off). */
export function readUsageDataEnabled(): boolean {
    try {
        return window.localStorage.getItem(USAGE_DATA_STORAGE_KEY) !== "off";
    } catch {
        // Storage blocked: nothing persisted, so the default applies.
        return true;
    }
}

/** Persist the user's choice. Best effort when storage is unavailable. */
export function writeUsageDataEnabled(enabled: boolean): void {
    try {
        if (enabled) window.localStorage.removeItem(USAGE_DATA_STORAGE_KEY);
        else window.localStorage.setItem(USAGE_DATA_STORAGE_KEY, "off");
    } catch {
        // The in-memory choice still applies for this load.
    }
}
