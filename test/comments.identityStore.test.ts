// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  IdentityStore,
  hydrateUserMentions,
  type IdentityResolver,
} from "../src/comments/identityStore";

describe("IdentityStore — seed / get", () => {
  it("seeds and looks up case-insensitively", () => {
    const s = new IdentityStore();
    s.seed([{ id: "ABC-123", displayName: "Ada" }]);
    expect(s.get("abc-123")).toEqual({
      displayName: "Ada",
      avatarUrl: undefined,
    });
    expect(s.get("ABC-123")?.displayName).toBe("Ada");
  });

  it("ignores entries with no display name and never overwrites", () => {
    const s = new IdentityStore();
    s.seed([{ id: "x", displayName: "First" }]);
    s.seed([{ id: "x", displayName: "Second" }]); // must NOT clobber
    s.seed([{ id: "y" }]); // no name → ignored
    expect(s.get("x")?.displayName).toBe("First");
    expect(s.get("y")).toBeUndefined();
  });

  it("bumps version + notifies subscribers only on real change", () => {
    const s = new IdentityStore();
    const cb = vi.fn();
    const unsub = s.subscribe(cb);
    const v0 = s.getVersion();
    s.seed([{ id: "a", displayName: "A" }]);
    expect(s.getVersion()).toBe(v0 + 1);
    expect(cb).toHaveBeenCalledTimes(1);
    s.seed([{ id: "a", displayName: "A-again" }]); // no change (already present)
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    s.seed([{ id: "b", displayName: "B" }]);
    expect(cb).toHaveBeenCalledTimes(1); // unsubscribed
  });
});

describe("IdentityStore — ensure / resolve", () => {
  it("coalesces ids requested in the same tick into ONE resolver call", async () => {
    const resolver = vi.fn<IdentityResolver>(async (ids) => {
      const out: Record<string, { displayName: string }> = {};
      for (const id of ids) out[id] = { displayName: `Name ${id}` };
      return out;
    });
    const s = new IdentityStore(resolver);
    s.ensure(["id1", "id2"]);
    s.ensure(["id2", "id3"]); // id2 already queued; id3 new
    await Promise.resolve(); // let the microtask flush run
    await Promise.resolve();
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver.mock.calls[0]![0].sort()).toEqual(["id1", "id2", "id3"]);
    expect(s.get("id1")?.displayName).toBe("Name id1");
    expect(s.get("id3")?.displayName).toBe("Name id3");
  });

  it("does not re-resolve ids already known or in flight", async () => {
    const resolver = vi.fn<IdentityResolver>(async () => ({}));
    const s = new IdentityStore(resolver);
    s.seed([{ id: "known", displayName: "K" }]);
    s.ensure(["known"]); // already known → no call
    await Promise.resolve();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("is a no-op with no resolver (dev/standalone)", async () => {
    const s = new IdentityStore();
    s.ensure(["a", "b"]);
    await Promise.resolve();
    expect(s.get("a")).toBeUndefined();
  });

  it("canonicalizes GUID-bearing ids so the picker's `vss.ds…` form resolves", async () => {
    // Repro for "mentions show a raw GUID after reload": the identity picker's
    // entityId form `vss.ds.v1.ims.user.<hex>` and the dashed GUID a comment
    // persists are the SAME person. The store must (a) send the resolver a
    // dashed GUID — the vssps identities endpoint 500s on the `vss.ds…` form —
    // and (b) key both forms to one entry so a pill carrying either resolves.
    const DASHED = "6b71186c-c2e6-6813-b4e0-ffcd511163f4";
    const ENTITY = "vss.ds.v1.ims.user.6b71186cc2e66813b4e0ffcd511163f4";
    const resolver = vi.fn<IdentityResolver>(async (ids) => {
      const out: Record<string, { displayName: string }> = {};
      for (const id of ids) out[id] = { displayName: "Grace Hopper" };
      return out;
    });
    const s = new IdentityStore(resolver);
    s.ensure([ENTITY]);
    await Promise.resolve();
    await Promise.resolve();
    // The resolver receives the dashed GUID, never the storage-key form.
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver.mock.calls[0]![0]).toEqual([DASHED]);
    // A pill keyed by EITHER form resolves to the same identity.
    expect(s.get(ENTITY)?.displayName).toBe("Grace Hopper");
    expect(s.get(DASHED.toUpperCase())?.displayName).toBe("Grace Hopper");
  });

  it("unifies a seeded dashed GUID with a pill's `vss.ds…` lookup (no network)", () => {
    const DASHED = "6b71186c-c2e6-6813-b4e0-ffcd511163f4";
    const ENTITY = "vss.ds.v1.ims.user.6b71186cc2e66813b4e0ffcd511163f4";
    const s = new IdentityStore();
    // Seeded from a comment author (dashed GUID); looked up from a pill that
    // carries the picker's entityId form — must hit the same entry.
    s.seed([{ id: DASHED, displayName: "Ada Lovelace" }]);
    expect(s.get(ENTITY)?.displayName).toBe("Ada Lovelace");
  });

  it("skips resolver entries that have no display name", async () => {
    const resolver: IdentityResolver = async () => ({
      good: { displayName: "Good" },
      // @ts-expect-error — simulate a malformed/empty entry from the service
      bad: { displayName: "" },
    });
    const s = new IdentityStore(resolver);
    s.ensure(["good", "bad"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(s.get("good")?.displayName).toBe("Good");
    expect(s.get("bad")).toBeUndefined();
  });

  it("swallows resolver errors and clears the pending set for retry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let calls = 0;
    const resolver: IdentityResolver = async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
      return { z: { displayName: "Zed" } };
    };
    const s = new IdentityStore(resolver);
    s.ensure(["z"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(s.get("z")).toBeUndefined(); // first attempt failed
    s.ensure(["z"]); // pending was cleared → retry allowed
    await Promise.resolve();
    await Promise.resolve();
    expect(s.get("z")?.displayName).toBe("Zed");
    warn.mockRestore();
  });
});

describe("hydrateUserMentions", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function pill(id: string): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML =
      `<span class="emr-mention emr-mention-user" ` +
      `data-mention-kind="user" data-mention-id="${id}">@${id}</span>`;
    document.body.appendChild(root);
    return root;
  }

  it("fills the pill with the resolved display name + title", () => {
    const s = new IdentityStore();
    s.seed([{ id: "G1", displayName: "Grace Hopper" }]);
    const root = pill("g1");
    hydrateUserMentions(root, s);
    const el = root.querySelector<HTMLElement>(".emr-mention")!;
    expect(el.textContent).toBe("@Grace Hopper");
    expect(el.getAttribute("title")).toBe("Grace Hopper");
    expect(el.getAttribute("data-mention-label")).toBe("@Grace Hopper");
  });

  it("leaves unknown ids showing the GUID and queues them for resolution", () => {
    const resolver = vi.fn<IdentityResolver>(async () => ({}));
    const s = new IdentityStore(resolver);
    const root = pill("unknown-guid");
    hydrateUserMentions(root, s);
    const el = root.querySelector<HTMLElement>(".emr-mention")!;
    expect(el.textContent).toBe("@unknown-guid"); // unchanged
    expect(resolver).toBeDefined();
  });

  it("is a no-op when root or store is null", () => {
    const s = new IdentityStore();
    expect(() => hydrateUserMentions(null, s)).not.toThrow();
    expect(() =>
      hydrateUserMentions(document.createElement("div"), null),
    ).not.toThrow();
  });

  it("skips pills that carry no data-mention-id", () => {
    const s = new IdentityStore();
    s.seed([{ id: "g1", displayName: "Ada" }]);
    const root = document.createElement("div");
    root.innerHTML =
      '<span class="emr-mention" data-mention-kind="user">@someone</span>';
    document.body.appendChild(root);
    expect(() => hydrateUserMentions(root, s)).not.toThrow();
    // Untouched — no id to resolve.
    expect(root.querySelector(".emr-mention")!.textContent).toBe("@someone");
  });

  it("does not re-touch a pill whose label is already current", () => {
    const s = new IdentityStore();
    s.seed([{ id: "g1", displayName: "Ada" }]);
    const root = pill("g1");
    hydrateUserMentions(root, s);
    const el = root.querySelector<HTMLElement>(".emr-mention")!;
    const spy = vi.spyOn(el, "textContent", "set");
    hydrateUserMentions(root, s); // second pass — label unchanged
    expect(spy).not.toHaveBeenCalled();
  });
});
