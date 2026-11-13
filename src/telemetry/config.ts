// Build-time telemetry configuration.
//
// The Application Insights connection string and Sentry DSN are injected at build time via webpack
// `DefinePlugin` (see webpack.config.cjs), which textually substitutes the
// global `__EMR_TELEMETRY_CONFIG__`. The name is vendor-neutral on purpose —
// it carries whatever credentials the selected sink needs.
//
// When no key is configured (local dev, standalone preview, Storybook, unit
// tests) the global is absent and telemetry degrades to a no-op/console sink.

import type { TelemetryBuildConfig } from "./buildConfig";

/**
 * Read the build-injected config defensively. The `typeof` guard keeps this
 * working in environments where DefinePlugin never ran (e.g. Vitest), where
 * referencing the global directly would throw a ReferenceError.
 */
export function readBuildConfig(): TelemetryBuildConfig {
    const raw =
        typeof __EMR_TELEMETRY_CONFIG__ !== "undefined" ? __EMR_TELEMETRY_CONFIG__ : undefined;

    const key = typeof raw?.key === "string" ? raw.key.trim() : "";
    const errorDsn = typeof raw?.errorDsn === "string" ? raw.errorDsn.trim() : "";

    return {
        key,
        errorDsn,
        appVersion:
            typeof raw?.appVersion === "string" && raw.appVersion.length > 0
                ? raw.appVersion
                : "0.0.0",
        environment: raw?.environment === "production" ? "production" : "development",
        // A connection string or DSN is the minimum required to talk to a real
        // backend. Without one we never attempt network egress.
        enabled: key.length > 0 || errorDsn.length > 0,
        // Allow forcing the console sink for local diagnostics even without a key.
        debug: raw?.debug === true,
    };
}
