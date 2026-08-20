// Shape of the build-time config global. Kept in its own module so both the
// runtime reader (`config.ts`) and the ambient declaration (`globals.d.ts`)
// reference one source of truth.

export interface TelemetryBuildConfig {
  /** Vendor-neutral ingestion key/instrumentation key. Empty disables egress. */
  key: string;
  /** Optional collector endpoint override. Sink picks a default when absent. */
  endpoint?: string;
  /** Extension version stamped onto every event. */
  appVersion: string;
  /** Deployment ring this build targets, for prod/dev slicing. */
  environment: "production" | "development";
  /** True when a real key is present and network egress is permitted. */
  enabled: boolean;
  /** Force console sink + verbose logging regardless of key presence. */
  debug: boolean;
}
