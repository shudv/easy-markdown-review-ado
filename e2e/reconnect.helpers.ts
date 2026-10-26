// Helpers for the reconnect / failure-condition e2e specs.
//
// They drive the dev-only fault injector (src/dev/faults.ts) inside the real
// PR-tab iframe via `window.__emrFaults`, and verify outcomes against Azure
// DevOps itself over REST (with the PAT from .env — the browser's session
// cookie can't authorize `_apis`), so "posted exactly once" is checked against
// the server, not just the UI.

import type { Frame, Page } from "@playwright/test";

import { expect } from "./fixtures";
import { DEV_ORIGIN_HOST, E2E } from "./env";

// --- Fault injector ---------------------------------------------------------

/** The live PR-tab iframe `Frame` (re-resolve after every reload). */
export async function prTabWindow(page: Page): Promise<Frame> {
  const find = () =>
    page
      .frames()
      .find(
        (f) =>
          f.url().includes(DEV_ORIGIN_HOST) && f.url().includes("pr-tab.html"),
      );
  await expect
    .poll(
      async () => {
        const frame = find();
        if (!frame) return false;
        return frame.evaluate(() => "__emrFaults" in window).catch(() => false);
      },
      {
        timeout: 45_000,
        message:
          "PR-tab iframe has no window.__emrFaults — is a DEV build (npm run dev:verify) being served?",
      },
    )
    .toBe(true);
  return find()!;
}

type FaultName =
  | "deadWindow"
  | "plain401"
  | "slowApi"
  | "hidden"
  | "failNextWrite"
  | "clear";

/**
 * Call one `window.__emrFaults` method inside the PR-tab iframe, e.g.
 * `fault(page, "deadWindow", { seconds: 60 })` or `fault(page, "slowApi", 16_000, 1)`.
 */
export async function fault(
  page: Page,
  name: FaultName,
  ...args: unknown[]
): Promise<void> {
  const frame = await prTabWindow(page);
  await frame.evaluate(
    ([n, a]) => {
      const api = (
        window as unknown as {
          __emrFaults: Record<string, (...x: unknown[]) => unknown>;
        }
      ).__emrFaults;
      api[n as string]!(...(a as unknown[]));
    },
    [name, args] as const,
  );
}

// --- Navigation / telemetry observers --------------------------------------

/** Count top-level (host page) navigations from now on. */
export function countHostNavigations(page: Page): () => number {
  let n = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) n += 1;
  });
  return () => n;
}

export interface TelemetryRecord {
  name: string;
  properties?: Record<string, unknown>;
  measurements?: Record<string, number>;
}

/**
 * Collect telemetry events the dev build logs through its console sink
 * (`TELEMETRY_DEBUG=1`, set by the Playwright web server). Returns a getter;
 * `false` from `active()` means the served build isn't logging telemetry (e.g.
 * a reused server started without the flag) — specs fail on that rather than
 * skip their telemetry asserts.
 */
export function collectTelemetry(page: Page): {
  events: () => TelemetryRecord[];
  active: () => boolean;
} {
  const events: TelemetryRecord[] = [];
  let sawInit = false;
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.startsWith("[telemetry] init")) sawInit = true;
    if (!text.startsWith("[telemetry] event")) return;
    const args = msg.args();
    void Promise.all([args[1]?.jsonValue(), args[2]?.jsonValue()])
      .then(([name, payload]) => {
        const p = (payload ?? {}) as Omit<TelemetryRecord, "name">;
        events.push({ name: String(name), ...p });
      })
      .catch(() => {
        /* handle disposed by a navigation — best effort */
      });
  });
  return { events: () => events, active: () => sawInit };
}

// --- ADO REST (PAT) ---------------------------------------------------------

function authHeader(): string {
  const pat = process.env.AZDO_PAT;
  if (!pat) throw new Error("AZDO_PAT is not set in .env");
  return "Basic " + Buffer.from(`:${pat}`, "utf8").toString("base64");
}

function threadsUrl(repo: string, prId: number, suffix = ""): string {
  return (
    `${E2E.orgUrl}/${encodeURIComponent(E2E.project)}/_apis/git/repositories/` +
    `${encodeURIComponent(repo)}/pullRequests/${prId}/threads${suffix}` +
    `${suffix.includes("?") ? "&" : "?"}api-version=7.1`
  );
}

interface RestComment {
  id: number;
  content?: string;
  isDeleted?: boolean;
}
interface RestThread {
  id: number;
  isDeleted?: boolean;
  comments?: RestComment[];
}

async function listThreads(repo: string, prId: number): Promise<RestThread[]> {
  const res = await fetch(threadsUrl(repo, prId), {
    headers: { Authorization: authHeader() },
  });
  expect(res.ok, `GET threads failed: ${res.status}`).toBe(true);
  return ((await res.json()) as { value: RestThread[] }).value;
}

/** Live (not deleted) comments on the PR whose text contains `marker`. */
export async function commentsContaining(
  repo: string,
  prId: number,
  marker: string,
): Promise<RestComment[]> {
  const threads = await listThreads(repo, prId);
  return threads
    .filter((t) => !t.isDeleted)
    .flatMap((t) => t.comments ?? [])
    .filter((c) => !c.isDeleted && (c.content ?? "").includes(marker));
}

/**
 * Delete every comment on the PR containing `marker` (replies before roots),
 * so runs — including failed ones — leave the shared sandbox PR clean.
 */
export async function deleteCommentsContaining(
  repo: string,
  prId: number,
  marker: string,
): Promise<void> {
  const threads = await listThreads(repo, prId);
  for (const thread of threads) {
    if (thread.isDeleted) continue;
    const comments = (thread.comments ?? []).filter((c) => !c.isDeleted);
    if (!comments.some((c) => (c.content ?? "").includes(marker))) continue;
    for (const c of [...comments].sort((a, b) => b.id - a.id)) {
      const res = await fetch(
        threadsUrl(repo, prId, `/${thread.id}/comments/${c.id}`),
        { method: "DELETE", headers: { Authorization: authHeader() } },
      );
      // 404: already gone (e.g. a concurrent sweep) — that's the goal anyway.
      // Anything else would silently leave test comments in the shared PR.
      if (!res.ok && res.status !== 404) {
        throw new Error(
          `Couldn't delete test comment ${thread.id}/${c.id} (${res.status} ${res.statusText}): ${await res.text()}`,
        );
      }
    }
  }
}

/** A marker unique to this test run, prefixed so stale ones can be swept. */
export function runMarker(label: string): string {
  return `e2e-reconnect-${label}-${Date.now().toString(36)}`;
}

/** Prefix shared by every reconnect-suite marker (for sweeping leftovers). */
export const MARKER_PREFIX = "e2e-reconnect-";
