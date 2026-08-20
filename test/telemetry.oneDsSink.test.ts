// The only branch of the 1DS adapter worth unit-testing: when the SDK fails to
// construct we must return null (not throw) so the facade can fall back to a
// no-op sink and the app keeps working. The rest of the adapter is thin
// `core.track` plumbing and is excluded from coverage (see vitest.config.ts).

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@microsoft/1ds-core-js", () => ({
  AppInsightsCore: vi.fn(() => {
    throw new Error("simulated 1DS init failure");
  }),
}));
vi.mock("@microsoft/1ds-post-js", () => ({
  PostChannel: vi.fn(),
}));

import { createOneDsSink } from "../src/telemetry/sinks/oneDsSink";
import type { TelemetryBuildConfig } from "../src/telemetry/buildConfig";

const config: TelemetryBuildConfig = {
  key: "test-key",
  appVersion: "1.0.0",
  environment: "development",
  enabled: true,
  debug: false,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("createOneDsSink", () => {
  it("returns null when the 1DS SDK cannot be constructed", () => {
    expect(createOneDsSink(config)).toBeNull();
  });
});
