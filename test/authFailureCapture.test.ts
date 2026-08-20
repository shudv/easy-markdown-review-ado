// Tests for the auth-failure capture helpers (pure parts): URL classification,
// id-free API area, the event-input builder, and the throttle.

import { describe, expect, it } from "vitest";

import {
  apiAreaOf,
  authFailureInput,
  createThrottle,
  isAdoApiUrl,
  isLegacyHost,
} from "../src/telemetry/authFailureCapture";

describe("isAdoApiUrl", () => {
  it("matches ADO REST URLs only", () => {
    expect(isAdoApiUrl("https://dev.azure.com/org/proj/_apis/git/x")).toBe(
      true,
    );
    expect(isAdoApiUrl("https://office.visualstudio.com/p/_apis/git/x")).toBe(
      true,
    );
    expect(isAdoApiUrl("https://dev.azure.com/org/_git/repo")).toBe(false);
    expect(isAdoApiUrl("https://example.com/foo")).toBe(false);
  });
});

describe("isLegacyHost", () => {
  it("is true only for {org}.visualstudio.com", () => {
    expect(isLegacyHost("https://office.visualstudio.com/p/_apis/git/x")).toBe(
      true,
    );
    expect(isLegacyHost("https://dev.azure.com/office/p/_apis/git/x")).toBe(
      false,
    );
    expect(isLegacyHost("https://almsearch.dev.azure.com/o/_apis/x")).toBe(
      false,
    );
  });
});

describe("apiAreaOf", () => {
  it("strips ids and dot-joins the first two segments, lowercased", () => {
    expect(
      apiAreaOf(
        "https://office.visualstudio.com/p/_apis/git/pullRequests/5345858",
      ),
    ).toBe("git.pullrequests");
  });

  it("drops GUID segments", () => {
    expect(
      apiAreaOf(
        "https://dev.azure.com/o/_apis/git/repositories/20053a6a-db9f-40dc-9deb-53536822791d/pullRequests",
      ),
    ).toBe("git.repositories");
  });

  it("returns undefined when there is nothing after _apis", () => {
    expect(apiAreaOf("https://dev.azure.com/o/_apis/")).toBeUndefined();
    expect(apiAreaOf("https://dev.azure.com/o/_git/repo")).toBeUndefined();
  });

  it("collapses to just the area when the second segment isn't an allow-listed controller (e.g. a project/repo name)", () => {
    expect(
      apiAreaOf("https://dev.azure.com/o/_apis/projects/SecretProject"),
    ).toBe("projects");
    expect(apiAreaOf("https://dev.azure.com/o/_apis/git/SecretRepoName")).toBe(
      "git",
    );
  });
});

describe("authFailureInput", () => {
  it("captures status, area, legacy host, and header presence as booleans", () => {
    const headers: Record<string, string> = {
      "x-tfs-fedauthredirect": "1",
      "www-authenticate": "Bearer",
    };
    const get = (n: string) => headers[n.toLowerCase()] ?? null;
    const out = authFailureInput(
      "https://office.visualstudio.com/p/_apis/git/pullRequests/1",
      401,
      get,
    );
    expect(out).toEqual({
      status: 401,
      api: "git.pullrequests",
      legacyHost: true,
      fedAuthRedirect: true,
      serviceError: false,
      wwwAuthenticate: true,
    });
  });
});

describe("createThrottle", () => {
  it("allows the first hit per key, blocks within the cooldown, re-allows after", () => {
    let now = 1000;
    const allow = createThrottle(30_000, () => now);
    expect(allow("401:git.pullrequests")).toBe(true);
    expect(allow("401:git.pullrequests")).toBe(false);
    expect(allow("403:git.pullrequests")).toBe(true); // different key
    now += 30_001;
    expect(allow("401:git.pullrequests")).toBe(true);
  });
});
