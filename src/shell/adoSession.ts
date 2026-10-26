// ADO session health — one shared view of the host token "dead window".
//
// Background (see adoAuthToken.ts): the host caches the extension's token by its
// AAD `exp`, but the embedded ADO grant (`ado_exp`) lapses ~10 min earlier, so
// for a while every REST call fails with TF400813 and `SDK.getAccessToken()`
// keeps returning the same dead token. The iframe cannot force a re-mint.
//
// What this module adds on top of the per-request detection:
//   - A single `live` / `refreshing` state the whole app shares. It turns
//     `refreshing` ONLY on a confirmed server rejection (a
//     `SessionRefreshingError`) — never from JWT timestamps alone, which caused
//     false "refreshing" screens before.
//   - Early resume: while refreshing it re-reads the host token every
//     `pollMs` (a postMessage to the host, not a network request) and flips back
//     to `live` the moment the host hands out a token whose grant is live — in
//     production the host usually re-mints minutes before the AAD `exp` that
//     callers used to wait for. Any successful ADO call also ends the spell.
//   - Held writes: a comment write rejected by the dead window waits for the
//     session to come back and is retried once, instead of failing. Safe: a
//     401 is rejected at the auth layer before any handler runs.
//   - Diagnostics: one `auth.sessionRefresh` start/end pair per spell with the
//     token timing, so the re-mint behaviour is measurable.
//
// SDK-free: the host token reader and host reload are injected by the entry
// points via `configure`, keeping this deterministically unit-testable.

import * as React from "react";

import { events, track, trackUserFacingError } from "../telemetry";
import {
  classifyAdoGrant,
  isSessionRefreshingError,
  readAdoTokenExpiry,
} from "./adoAuthToken";

type AdoSessionState = "live" | "refreshing";

export interface AdoSessionSnapshot {
  state: AdoSessionState;
  /** Comment writes currently waiting for the session to come back. */
  heldWrites: number;
  /** Whether a host-page reload is available (wired by the entry point). */
  canReload: boolean;
}

export type SessionSpellTrigger = "boot" | "poll" | "write";
type SpellOutcome =
  | "remint"
  | "success"
  | "reload-auto"
  | "reload-user"
  | "left";

export interface AdoSessionDeps {
  /** Reads the host's current access token (`SDK.getAccessToken`). */
  getToken?: () => Promise<string>;
  /** Reloads the HOST page so it mints a fresh token immediately. */
  reloadHost?: () => void | Promise<void>;
}

/** How often the host token is re-read while refreshing. */
export const SESSION_POLL_MS = 10_000;
/** Slower cadence once a spell outlasts the widest observed dead window. */
export const SESSION_SLOW_POLL_MS = 60_000;
/** Spell age after which polling slows to {@link SESSION_SLOW_POLL_MS}. */
export const SESSION_SLOW_AFTER_MS = 11 * 60_000;
/**
 * Longest a comment write is held before it fails with the usual "reload"
 * message — just above the widest observed dead window.
 */
export const HELD_WRITE_MAX_WAIT_MS = 12 * 60_000;

interface Spell {
  trigger: SessionSpellTrigger;
  startedAtMs: number;
  grantState: string;
  /** AAD `exp` of the rejected token (when the spell must end at the latest). */
  expMs?: number;
  /** Embedded `ado_exp` of the dead token, once read. */
  adoExpMs?: number;
  /** The `end` event was already sent (a reload / page hide closed it). */
  endReported?: boolean;
}

const LIVE: AdoSessionSnapshot = {
  state: "live",
  heldWrites: 0,
  canReload: false,
};

export class AdoSessionMonitor {
  private snapshot: AdoSessionSnapshot = LIVE;
  private readonly listeners = new Set<() => void>();
  private readonly recoveredListeners = new Set<() => void>();
  private readonly waiters = new Set<() => void>();
  private spell: Spell | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private getToken?: () => Promise<string>;
  private reloadHostFn?: () => void | Promise<void>;
  private pageHideInstalled = false;

  constructor(private readonly now: () => number = Date.now) {}

  /** Wire the host token reader and reload. Called once by each entry point. */
  configure(deps: AdoSessionDeps): void {
    this.getToken = deps.getToken;
    this.reloadHostFn = deps.reloadHost;
    this.update({ canReload: !!deps.reloadHost });
    if (!this.pageHideInstalled) {
      this.pageHideInstalled = true;
      window.addEventListener("pagehide", () => this.notePageHide());
    }
  }

  getSnapshot = (): AdoSessionSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Notified each time a refreshing spell ends (the session is usable again). */
  onRecovered = (listener: () => void): (() => void) => {
    this.recoveredListeners.add(listener);
    return () => this.recoveredListeners.delete(listener);
  };

  /**
   * Record a failure. Returns true (and enters `refreshing`) only when it is a
   * confirmed dead-window `SessionRefreshingError`; anything else is ignored.
   */
  report(err: unknown, trigger: SessionSpellTrigger): boolean {
    if (!isSessionRefreshingError(err)) return false;
    if (this.spell) return true;
    const startedAtMs = this.now();
    this.spell = {
      trigger,
      startedAtMs,
      grantState: err.grantState,
      expMs: err.recoverAtMs,
    };
    track(
      events.authSessionRefresh({
        phase: "start",
        trigger,
        grantState: err.grantState,
        ...(err.recoverAtMs !== undefined
          ? { secsUntilExpAtStart: (err.recoverAtMs - startedAtMs) / 1000 }
          : {}),
      }),
    );
    this.update({ state: "refreshing" });
    this.schedule(0);
    return true;
  }

  /**
   * An ADO call succeeded: the session is demonstrably usable. Only counts
   * for a request started at or after the current spell began — a slow
   * request authenticated before the grant lapsed proves nothing about the
   * token the host is serving now.
   */
  noteSuccess(requestStartedAtMs: number): void {
    if (this.spell && requestStartedAtMs >= this.spell.startedAtMs) {
      this.recover("success");
    }
  }

  /** Resolves `true` once live, or `false` after `timeoutMs`. */
  waitUntilLive(timeoutMs: number): Promise<boolean> {
    if (!this.spell) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const done = (live: boolean): void => {
        clearTimeout(timeout);
        this.waiters.delete(onLive);
        resolve(live);
      };
      const onLive = (): void => done(true);
      const timeout = setTimeout(() => done(false), timeoutMs);
      this.waiters.add(onLive);
    });
  }

  /**
   * Run a write; if the dead window rejects it, hold it until the session is
   * live again (up to `maxWaitMs`) and retry once. Any other failure — or a
   * second rejection, or a hold that times out — rethrows the error.
   */
  async holdWrite<T>(
    attempt: () => Promise<T>,
    maxWaitMs: number = HELD_WRITE_MAX_WAIT_MS,
  ): Promise<T> {
    try {
      const startedAt = this.now();
      const result = await attempt();
      this.noteSuccess(startedAt);
      return result;
    } catch (err) {
      if (!this.report(err, "write")) throw err;
      this.update({ heldWrites: this.snapshot.heldWrites + 1 });
      let live: boolean;
      try {
        live = await this.waitUntilLive(maxWaitMs);
      } finally {
        this.update({ heldWrites: this.snapshot.heldWrites - 1 });
      }
      if (!live) throw err;
      try {
        const startedAt = this.now();
        const result = await attempt();
        this.noteSuccess(startedAt);
        return result;
      } catch (retryErr) {
        this.report(retryErr, "write");
        throw retryErr;
      }
    }
  }

  /**
   * Reload the host page. Resolves `true` once the reload was requested, or
   * `false` when no reload is wired or the request failed (reported as a
   * user-facing failure) — so the caller can offer another way out.
   *
   * A successful request closes the spell for the diagnostics only: the
   * session is NOT back yet, so held writes stay held and nothing is told to
   * resume until a real re-mint or success.
   */
  async reloadHost(by: "auto" | "user"): Promise<boolean> {
    if (!this.reloadHostFn) return false;
    try {
      await this.reloadHostFn();
    } catch (error) {
      trackUserFacingError({
        error,
        source: "AdoSession.reloadHost",
        operation: "host-reload",
        impact: by === "user" ? "action-failed" : "degraded",
      });
      return false;
    }
    this.reportEnd(by === "auto" ? "reload-auto" : "reload-user");
    return true;
  }

  /**
   * The page is going away mid-spell: close it out for the diagnostics only.
   * (`pagehide` also fires on entering the back/forward cache, after which the
   * page can resume — so the spell itself stays open.)
   */
  notePageHide(): void {
    this.reportEnd("left");
  }

  private schedule(delayMs: number): void {
    // Only called with no timer pending: from `report` (a fresh spell) and from
    // a fired check. `end` clears any pending timer.
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.checkToken();
    }, delayMs);
  }

  private async checkToken(): Promise<void> {
    const spell = this.spell;
    /* v8 ignore next -- `recover` clears the timer, so a check never runs spell-less */
    if (!spell) return;
    let token: string | null;
    try {
      token = this.getToken ? await this.getToken() : null;
    } catch {
      token = null;
    }
    if (this.spell !== spell) return;
    if (token !== null) {
      const { state } = classifyAdoGrant(token, this.now());
      // `unknown` = undecodable: never hold the app hostage to a parse miss.
      if (state === "live" || state === "unknown") {
        this.recover("remint");
        return;
      }
      if (spell.adoExpMs === undefined) {
        spell.adoExpMs = readAdoTokenExpiry(token).adoExpMs;
      }
    }
    const age = this.now() - spell.startedAtMs;
    this.schedule(
      age >= SESSION_SLOW_AFTER_MS ? SESSION_SLOW_POLL_MS : SESSION_POLL_MS,
    );
  }

  /** Send the spell's `end` event once (no state change). */
  private reportEnd(outcome: SpellOutcome): void {
    const spell = this.spell;
    if (!spell || spell.endReported) return;
    spell.endReported = true;
    const nowMs = this.now();
    track(
      events.authSessionRefresh({
        phase: "end",
        trigger: spell.trigger,
        grantState: spell.grantState,
        outcome,
        durationSec: (nowMs - spell.startedAtMs) / 1000,
        heldWrites: this.snapshot.heldWrites,
        ...(spell.expMs !== undefined
          ? {
              secsUntilExpAtStart: (spell.expMs - spell.startedAtMs) / 1000,
              secsBeforeExpAtEnd: (spell.expMs - nowMs) / 1000,
            }
          : {}),
        ...(spell.adoExpMs !== undefined
          ? {
              secsSinceAdoExpAtStart:
                (spell.startedAtMs - spell.adoExpMs) / 1000,
            }
          : {}),
      }),
    );
  }

  /** The session is usable again: end the spell and release everyone. */
  private recover(outcome: "remint" | "success"): void {
    this.reportEnd(outcome);
    this.spell = null;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.update({ state: "live" });
    for (const waiter of [...this.waiters]) waiter();
    for (const listener of [...this.recoveredListeners]) listener();
  }

  private update(patch: Partial<AdoSessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
}

/** The app-wide monitor. Entry points `configure` it with the SDK. */
export const adoSession = new AdoSessionMonitor();

/** React view of {@link adoSession}. */
export function useAdoSession(
  monitor: AdoSessionMonitor = adoSession,
): AdoSessionSnapshot {
  return React.useSyncExternalStore(monitor.subscribe, monitor.getSnapshot);
}

// ---------------------------------------------------------------------------
// Boot auto-reload guard
// ---------------------------------------------------------------------------

/**
 * How long boot waits for an early re-mint before reloading the host page. A
 * host reload escaped the dead window about 3 times in 4 in production (74% of
 * reloads within 20s loaded straight in, vs ~7% per 30s of waiting), while
 * waiting it out took minutes and about half of the users gave up. The other
 * quarter land back in the window, so this happens at most once per cooldown.
 */
export const BOOT_AUTO_RELOAD_AFTER_MS = 4_000;
/**
 * If the page is still here this long after the automatic reload was
 * requested, the reload didn't happen — offer the manual action instead.
 */
export const AUTO_RELOAD_STALL_MS = 10_000;
/** At most one automatic host reload per this window, to rule out loops. */
export const AUTO_RELOAD_COOLDOWN_MS = 10 * 60_000;
export const AUTO_RELOAD_STORAGE_KEY = "emr.sessionAutoReloadAt";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** `window.sessionStorage`, or undefined where reading it throws (sandboxing). */
export function sessionStorageOrUndefined(): StorageLike | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function lastAutoReloadAt(storage: StorageLike): number | null {
  const last = Number(storage.getItem(AUTO_RELOAD_STORAGE_KEY));
  return Number.isFinite(last) && last > 0 ? last : null;
}

/** A load within this long of our automatic reload is that reload's result. */
export const AUTO_RELOAD_RESULT_WINDOW_MS = 2 * 60_000;
/** Which automatic reload (by claim time) a page load has already been tagged for. */
export const AUTO_RELOAD_SEEN_STORAGE_KEY = "emr.sessionAutoReloadSeen";

/**
 * Is this page load the result of an automatic host reload we triggered (one
 * claimed within {@link AUTO_RELOAD_RESULT_WINDOW_MS})? Lets boot telemetry
 * show how often the reload actually escapes the dead window. Only the FIRST
 * load after each automatic reload counts: the answer is consumed, so a later
 * manual reload or navigation inside the window isn't mis-tagged. (The claim
 * itself stays — it is the reload-loop guard.)
 */
export function followsRecentAutoReload(
  storage: StorageLike | undefined,
  nowMs: number,
): boolean {
  if (!storage) return false;
  try {
    const last = lastAutoReloadAt(storage);
    if (
      last === null ||
      nowMs < last ||
      nowMs - last >= AUTO_RELOAD_RESULT_WINDOW_MS ||
      storage.getItem(AUTO_RELOAD_SEEN_STORAGE_KEY) === String(last)
    ) {
      return false;
    }
    storage.setItem(AUTO_RELOAD_SEEN_STORAGE_KEY, String(last));
    return true;
  } catch {
    return false;
  }
}

/** Read-only: would {@link claimAutoReload} allow a reload right now? */
export function autoReloadAllowed(
  storage: StorageLike | undefined,
  nowMs: number,
  cooldownMs: number = AUTO_RELOAD_COOLDOWN_MS,
): boolean {
  if (!storage) return false;
  try {
    const last = lastAutoReloadAt(storage);
    return last === null || nowMs - last >= cooldownMs;
  } catch {
    return false;
  }
}

/**
 * Claim the one automatic reload allowed per {@link AUTO_RELOAD_COOLDOWN_MS}.
 * Returns true (and records the claim) when allowed. Storage that is missing
 * or throws (sandboxed iframes) denies the reload — without a durable guard we
 * can't rule out a reload loop.
 */
export function claimAutoReload(
  storage: StorageLike | undefined,
  nowMs: number,
  cooldownMs: number = AUTO_RELOAD_COOLDOWN_MS,
): boolean {
  if (!autoReloadAllowed(storage, nowMs, cooldownMs)) return false;
  try {
    storage!.setItem(AUTO_RELOAD_STORAGE_KEY, String(nowMs));
    return storage!.getItem(AUTO_RELOAD_STORAGE_KEY) === String(nowMs);
  } catch {
    return false;
  }
}
