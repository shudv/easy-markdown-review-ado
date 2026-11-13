// Shape of the build-time config global. Kept in its own module so both the
// runtime reader (`config.ts`) and the ambient declaration (`globals.d.ts`)
// reference one source of truth.

export interface TelemetryBuildConfig {
    /** Application Insights connection string. Empty disables usage telemetry. */
    key: string;
    /** Sentry DSN for exception reports. Empty disables error reporting. */
    errorDsn: string;
    /** Extension version stamped onto every event. */
    appVersion: string;
    /** Deployment ring this build targets, for prod/dev slicing. */
    environment: "production" | "development";
    /** True when a connection string or DSN is present and network egress is permitted. */
    enabled: boolean;
    /** Force console sink + verbose logging regardless of key presence. */
    debug: boolean;
}
