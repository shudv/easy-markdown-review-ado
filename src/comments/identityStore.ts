// Central identity store: one shared cache of `GUID -> { displayName, avatarUrl }`
// so every rendered comment resolves `@<GUID>` user mentions the same way ADO
// does — look the id up once, reuse everywhere.
//
// Design (kept deliberately small so it's easy to reason about):
//   * One `Map`, keyed by lower-cased GUID. Single source of truth.
//   * `seed(...)` fills it for free from data we already have (comment authors,
//     the people shown in the @-picker). No network.
//   * `ensure(ids)` lazily resolves misses via an injected resolver, coalescing
//     all ids requested in the same tick into ONE call, then bumps a version so
//     views re-hydrate to the resolved name. Failures are swallowed (the mention
//     just keeps showing its GUID).
//   * React subscribes via `subscribe` / `getVersion` (useSyncExternalStore).
//
// Rendering never blocks on the network: a GUID shows immediately and the name
// swaps in when known.

import * as React from "react";

import { normalizeIdentityGuid } from "./mentions";

export interface IdentityInfo {
  displayName: string;
  avatarUrl?: string;
}

/** Resolve a batch of ids to identity info. Missing ids may be omitted. */
export type IdentityResolver = (
  ids: string[],
) => Promise<Record<string, IdentityInfo>>;

// Canonicalize an identity id for use as a store key AND as the value sent to
// the resolver. ADO surfaces the same person under different id forms — the
// dashed GUID (comments/authors) and the `vss.ds.v1.ims.user.<hex>` storage key
// (the identity picker's entityId). Collapsing both to the dashed GUID means a
// pill keyed by either form resolves to one entry, and the resolver only ever
// receives dashed GUIDs (the vssps identities endpoint 500s on the storage
// form). Non-GUID ids (dev fixtures like `u-alex`) fall back to a plain
// lower-cased key.
const norm = (id: string): string =>
  normalizeIdentityGuid(id) ?? id.trim().toLowerCase();

export class IdentityStore {
  private readonly map = new Map<string, IdentityInfo>();
  private readonly pending = new Set<string>();
  private readonly queued = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private flushScheduled = false;

  constructor(private readonly resolver?: IdentityResolver) {}

  /** Look up an identity by id (case-insensitive), or undefined. */
  get(id: string): IdentityInfo | undefined {
    return this.map.get(norm(id));
  }

  /** Monotonic counter that changes whenever the map changes. */
  getVersion = (): number => this.version;

  /** Subscribe to store changes (for `useSyncExternalStore`). */
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  /**
   * Add identities we already know (comment authors, @-picker results). Only
   * fills entries with a non-empty display name and never overwrites an
   * existing entry, so a richer async result isn't clobbered by a reseed.
   */
  seed(
    entries: Iterable<{ id: string; displayName?: string; avatarUrl?: string }>,
  ): void {
    let changed = false;
    for (const e of entries) {
      if (!e.displayName) continue;
      const key = norm(e.id);
      if (!key || this.map.has(key)) continue;
      this.map.set(key, {
        displayName: e.displayName,
        avatarUrl: e.avatarUrl,
      });
      changed = true;
    }
    if (changed) this.emit();
  }

  /**
   * Ensure the given ids get resolved. Already-known and in-flight ids are
   * skipped; the rest are coalesced and resolved in a single batch on the next
   * microtask. No-op when no resolver was provided (dev/standalone).
   */
  ensure(ids: readonly string[]): void {
    if (!this.resolver) return;
    let added = false;
    for (const raw of ids) {
      const key = norm(raw);
      if (!key || this.map.has(key) || this.pending.has(key)) continue;
      this.queued.add(key);
      added = true;
    }
    if (added && !this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => void this.flush());
    }
  }

  private async flush(): Promise<void> {
    this.flushScheduled = false;
    const ids = [...this.queued];
    this.queued.clear();
    /* v8 ignore next -- defensive: flush only runs after ids were queued */
    if (ids.length === 0) return;
    for (const k of ids) this.pending.add(k);
    try {
      const resolved = await this.resolver!(ids);
      let changed = false;
      for (const [id, info] of Object.entries(resolved)) {
        if (!info?.displayName) continue;
        this.map.set(norm(id), {
          displayName: info.displayName,
          avatarUrl: info.avatarUrl,
        });
        changed = true;
      }
      if (changed) this.emit();
    } catch (err) {
      // Best-effort: a failed lookup just leaves the mention showing its GUID.

      console.warn("[identityStore] resolve failed", err);
    } finally {
      for (const k of ids) this.pending.delete(k);
    }
  }

  private emit(): void {
    this.version++;
    for (const l of this.listeners) l();
  }
}

/**
 * Context carrying the shared IdentityStore. `null` means "no store" — consumers
 * fall back to showing the raw GUID (never crash).
 */
export const IdentityStoreContext = React.createContext<IdentityStore | null>(
  null,
);

export function useIdentityStore(): IdentityStore | null {
  return React.useContext(IdentityStoreContext);
}

/**
 * Fill every rendered user-mention pill (`span.emr-mention[data-mention-kind=
 * "user"]`) inside `root` with the person's display name from the store. Ids
 * not yet known are queued for async resolution via `store.ensure`, and the
 * pill keeps showing its GUID until the name lands. Idempotent — safe to run on
 * every render. When known, sets `@Name`, a hover title, and a stable
 * `data-mention-label` marker.
 */
export function hydrateUserMentions(
  root: HTMLElement | null,
  store: IdentityStore | null,
): void {
  if (!root || !store) return;
  const pills = root.querySelectorAll<HTMLElement>(
    'span.emr-mention[data-mention-kind="user"]',
  );
  const unresolved: string[] = [];
  pills.forEach((el) => {
    const id = el.getAttribute("data-mention-id");
    if (!id) return;
    const info = store.get(id);
    if (info) {
      const label = `@${info.displayName}`;
      // Only touch the DOM when the label actually changed, so we don't thrash.
      if (el.getAttribute("data-mention-label") !== label) {
        el.textContent = label;
        el.setAttribute("data-mention-label", label);
        el.setAttribute("title", info.displayName);
      }
    } else {
      unresolved.push(id);
    }
  });
  if (unresolved.length > 0) store.ensure(unresolved);
}

/**
 * Hook: hydrate user mentions inside `ref` from the shared identity store,
 * re-running whenever the store resolves new identities (version bump) or the
 * given deps change. Uses `useLayoutEffect` so names are visible before paint.
 */
export function useUserMentionHydration(
  ref: React.RefObject<HTMLElement | null>,
  deps: React.DependencyList,
): void {
  const store = useIdentityStore();
  const version = useIdentityVersion(store);
  React.useLayoutEffect(() => {
    hydrateUserMentions(ref.current, store);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, version, ...deps]);
}

/**
 * Subscribe a component to the store's version so it re-renders when identities
 * resolve. Returns the current version (or 0 when there's no store).
 */
export function useIdentityVersion(store: IdentityStore | null): number {
  const subscribe = React.useCallback(
    (cb: () => void) => (store ? store.subscribe(cb) : () => {}),
    [store],
  );
  const getSnapshot = React.useCallback(
    () => (store ? store.getVersion() : 0),
    [store],
  );
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
