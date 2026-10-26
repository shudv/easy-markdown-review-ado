// Unit tests for the in-document anchor helpers (src/shell/headingAnchors.ts):
// slug-tolerant target lookup, collapsed-section reveal, the landing cue, and
// the scroll hold that keeps a deep-linked heading in view while late content
// settles. jsdom has no layout, so scrolling is asserted via spies.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ANCHOR_TARGET_CLASS,
  ANCHOR_TARGET_CUE_MS,
  currentTextCue,
  findAnchorTarget,
  flashAnchorTarget,
  flashTextTarget,
  holdScrollOnTarget,
  revealAnchorTarget,
} from "../src/shell/headingAnchors";
import { readSectionState } from "../src/shell/components/navStorage";

function mount(html: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "emr-article-wrap";
  wrap.innerHTML = `<div class="markdown-body emr-rendered">${html}</div>`;
  document.body.appendChild(wrap);
  return wrap.querySelector<HTMLElement>(".emr-rendered")!;
}

afterEach(() => {
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("findAnchorTarget", () => {
  it("finds an element by its literal id", () => {
    const root = mount(`<h2 id="goals">Goals</h2>`);
    expect(findAnchorTarget(root, "goals")?.textContent).toBe("Goals");
  });

  it("tolerates a leading # and surrounding whitespace", () => {
    const root = mount(`<h2 id="goals">Goals</h2>`);
    expect(findAnchorTarget(root, "  #goals ")?.id).toBe("goals");
  });

  it("matches a percent-encoded anchor", () => {
    const root = mount(`<h2 id="a&b">A&amp;B</h2>`);
    expect(findAnchorTarget(root, "a%26b")?.id).toBe("a&b");
  });

  it.each([
    ["ADO preview slug", "classifiers-&-hashing"],
    ["ADO preview slug, encoded", "classifiers-%26-hashing"],
    ["GitHub slug", "classifiers--hashing"],
    ["mixed case", "Classifiers-Hashing"],
  ])("maps a foreign %s onto our heading id", (_label, anchor) => {
    // Our slugger renders "Classifiers & Hashing" as `classifiers-hashing`.
    const root = mount(
      `<h2 id="classifiers-hashing">Classifiers &amp; Hashing</h2>`,
    );
    expect(findAnchorTarget(root, anchor)?.id).toBe("classifiers-hashing");
  });

  it("skips headings inside removed/Before reference content", () => {
    const root = mount(`
      <div class="emr-diff-deleted-marker"><div class="emr-diff-deleted-body"><h2 id="goals">Old goals</h2></div></div>
      <div class="emr-diff-before-panel"><h2 id="goals">Before goals</h2></div>
      <div class="emr-diff-metadata-panel"><h2 id="goals">Meta goals</h2></div>
      <h2 id="goals">Goals</h2>`);
    expect(findAnchorTarget(root, "goals")?.textContent).toBe("Goals");
  });

  it("returns null when only reference content carries the id", () => {
    const root = mount(
      `<div class="emr-diff-before-panel"><h2 id="goals">Before</h2></div>`,
    );
    expect(findAnchorTarget(root, "goals")).toBeNull();
  });

  it("returns null for a blank anchor or a renamed heading", () => {
    const root = mount(`<h2 id="goals">Goals</h2>`);
    expect(findAnchorTarget(root, "")).toBeNull();
    expect(findAnchorTarget(root, "#")).toBeNull();
    expect(findAnchorTarget(root, "objectives")).toBeNull();
  });

  it("does not reslug punctuation-only anchors onto the generic fallback id", () => {
    // `slugifyHeading("&&")` is the generic "section"; that must not match.
    const root = mount(`<h2 id="section">Section</h2>`);
    expect(findAnchorTarget(root, "&&")).toBeNull();
  });

  it.each(["目标", "обзор", "%E7%9B%AE%E6%A0%87"])(
    "does not reslug a non-ASCII anchor (%s) onto the generic fallback id",
    (anchor) => {
      // Our slugger keeps ASCII only, so every CJK/Cyrillic heading is
      // `section`, `section-2`… A foreign Unicode slug must not land on the
      // first of them.
      const root = mount(
        `<h2 id="section">目标</h2><h2 id="section-2">обзор</h2>`,
      );
      expect(findAnchorTarget(root, anchor)).toBeNull();
    },
  );

  it("still matches our own fallback ids for non-ASCII headings", () => {
    const root = mount(
      `<h2 id="section">目标</h2><h2 id="section-2">обзор</h2>`,
    );
    expect(findAnchorTarget(root, "section-2")?.textContent).toBe("обзор");
  });

  it("survives a malformed percent-escape", () => {
    const root = mount(`<h2 id="100-done">100% done</h2>`);
    expect(findAnchorTarget(root, "100%-done")?.id).toBe("100-done");
  });

  it("matches ids containing selector metacharacters", () => {
    const root = mount(`<h2 id='a"]b'>x</h2>`);
    expect(findAnchorTarget(root, 'a"]b')).not.toBeNull();
  });
});

describe("revealAnchorTarget", () => {
  const nested = `
    <section class="emr-section" data-section-id="outer" data-collapsed="true">
      <h2 id="outer"><button class="emr-section-toggle" aria-expanded="false" aria-label="Expand section"></button>Outer</h2>
      <section class="emr-section" data-section-id="inner" data-collapsed="true">
        <h3 id="inner"><button class="emr-section-toggle" aria-expanded="false" aria-label="Expand section"></button>Inner</h3>
        <p>Body</p>
      </section>
    </section>`;

  it("expands the target's own and every ancestor section, syncing chevrons", () => {
    const root = mount(nested);
    sessionStorage.setItem("emr.section./a.md.outer", "1");
    sessionStorage.setItem("emr.section./a.md.inner", "1");
    const onChanged = vi.fn();
    root.parentElement!.addEventListener("emr-sections-changed", onChanged);
    const onOutside = vi.fn();
    document.body.addEventListener("emr-sections-changed", onOutside);

    const target = root.querySelector<HTMLElement>("#inner")!;
    expect(revealAnchorTarget(target, "/a.md")).toBe(true);

    for (const section of root.querySelectorAll(".emr-section")) {
      expect(section.hasAttribute("data-collapsed")).toBe(false);
    }
    for (const toggle of root.querySelectorAll<HTMLElement>(
      ".emr-section-toggle",
    )) {
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(toggle.getAttribute("aria-label")).toBe("Collapse section");
      expect(toggle.title).toBe("Collapse section");
    }
    // Persisted as open, like a manual expand.
    expect(readSectionState("/a.md", "outer")).toBe(false);
    expect(readSectionState("/a.md", "inner")).toBe(false);
    expect(onChanged).toHaveBeenCalledTimes(1);
    // Scoped to this article wrap: it doesn't bubble to the page.
    expect(onOutside).not.toHaveBeenCalled();
    document.body.removeEventListener("emr-sections-changed", onOutside);
  });

  it("is a no-op (no event) when nothing is collapsed", () => {
    const root = mount(
      `<section class="emr-section" data-section-id="s"><h2 id="s">S</h2></section>`,
    );
    const onChanged = vi.fn();
    root.parentElement!.addEventListener("emr-sections-changed", onChanged);
    expect(revealAnchorTarget(root.querySelector("#s")!, "/a.md")).toBe(false);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("tolerates a section without a chevron or id, outside an article wrap", () => {
    const host = document.createElement("div");
    host.innerHTML = `<section class="emr-section" data-collapsed="true"><h2 id="t">T</h2></section>`;
    document.body.appendChild(host);
    const target = host.querySelector<HTMLElement>("#t")!;
    expect(revealAnchorTarget(target, "/a.md")).toBe(true);
    expect(
      host.querySelector(".emr-section")!.hasAttribute("data-collapsed"),
    ).toBe(false);
    // Nothing to persist for a section without an id.
    expect(sessionStorage.length).toBe(0);
  });
});

describe("flashAnchorTarget", () => {
  const flush = (ms = 0) => new Promise((r) => setTimeout(r, ms));
  const cueOf = (el: Element) =>
    el.querySelector<HTMLElement>(`:scope > .${ANCHOR_TARGET_CLASS}`);
  const HEADING =
    '<h2 id="goals"><button class="emr-section-toggle"></button>Goals <em>now</em><button class="emr-heading-link"></button></h2>';

  it("wraps only the heading's text in the cue, for its full duration", () => {
    vi.useFakeTimers();
    const root = mount(HEADING);
    const heading = root.querySelector<HTMLElement>("#goals")!;
    const pristine = heading.innerHTML;
    flashAnchorTarget(root, () => heading);

    // The wash hugs the words (an inline span), like a comment highlight —
    // never the heading block, and never the chevron or link button.
    const cue = cueOf(heading)!;
    expect(cue.tagName).toBe("SPAN");
    expect(cue.textContent).toBe("Goals now");
    expect(heading.classList.contains(ANCHOR_TARGET_CLASS)).toBe(false);
    expect(heading.firstElementChild!.className).toBe("emr-section-toggle");
    expect(heading.lastElementChild!.className).toBe("emr-heading-link");

    vi.advanceTimersByTime(ANCHOR_TARGET_CUE_MS - 1);
    expect(cueOf(heading)).not.toBeNull();
    vi.advanceTimersByTime(1);
    // Unwrapped again: the heading is exactly as it was.
    expect(cueOf(heading)).toBeNull();
    expect(heading.innerHTML).toBe(pristine);
  });

  it("puts the cue on a target that has no text of its own", () => {
    vi.useFakeTimers();
    const root = mount(`<p><a id="fn1"> </a>Footnote</p>`);
    const anchor = root.querySelector<HTMLElement>("#fn1")!;
    flashAnchorTarget(root, () => anchor);
    // Whitespace isn't text: the anchor itself carries the cue, from the start.
    expect(anchor.classList.contains(ANCHOR_TARGET_CLASS)).toBe(true);
    expect(anchor.style.animationDelay).toBe("");
    vi.advanceTimersByTime(ANCHOR_TARGET_CUE_MS);
    expect(anchor.classList.contains(ANCHOR_TARGET_CLASS)).toBe(false);
    // Left in place (only an inserted wrapper is ever unwrapped).
    expect(root.contains(anchor)).toBe(true);
    expect(anchor.textContent).toBe(" ");
  });

  it("leaves the diff's Before disclosure outside the cue", () => {
    vi.useFakeTimers();
    const root = mount(
      '<h2 id="goals">Goals<button class="emr-diff-before-control">Before</button></h2>',
    );
    const heading = root.querySelector<HTMLElement>("#goals")!;
    flashAnchorTarget(root, () => heading);
    expect(cueOf(heading)!.textContent).toBe("Goals");
  });

  it("continues a re-wrapped text-less target's fade, then clears it", async () => {
    const root = mount(`<p><a id="fn1"></a>Footnote</p>`);
    const resolve = () => root.querySelector<HTMLElement>("#fn1");
    const cancel = flashAnchorTarget(root, resolve);
    await flush(5);
    root.innerHTML = `<p><a id="fn1"></a>Footnote</p>`;
    await flush();
    const anchor = resolve()!;
    // Picks up where the fade was: a few ms in, never past its end.
    const delay = -parseInt(anchor.style.animationDelay, 10);
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThan(ANCHOR_TARGET_CUE_MS);
    cancel();
    expect(anchor.classList.contains(ANCHOR_TARGET_CLASS)).toBe(false);
    expect(anchor.style.animationDelay).toBe("");
  });

  it("keeps the cue on the heading when the article is re-wrapped", async () => {
    // Threads / diffs landing after a deep-linked document renders rebuild the
    // article's DOM; the fresh heading must carry the cue on, mid-fade.
    const root = mount(`<p>Intro</p>${HEADING}`);
    const resolve = () => root.querySelector<HTMLElement>("#goals");
    const cancel = flashAnchorTarget(root, resolve);
    const before = resolve()!;
    await flush(5);

    root.innerHTML = `<p>Intro</p>${HEADING}`;
    await flush();
    const after = resolve()!;
    expect(after).not.toBe(before);
    const cue = cueOf(after)!;
    expect(cue.textContent).toBe("Goals now");
    // Continues the running animation rather than restarting it.
    expect(cue.style.animationDelay).toMatch(/^-\d+ms$/);

    // Unrelated mutations (and the cue's own wrapping) leave it alone.
    root.querySelector("p")!.append(document.createElement("span"));
    await flush();
    expect(resolve()).toBe(after);
    expect(after.querySelectorAll(`.${ANCHOR_TARGET_CLASS}`)).toHaveLength(1);

    cancel();
    expect(cueOf(after)).toBeNull();
    expect(after.textContent).toBe("Goals now");
    cancel(); // idempotent
  });

  it("stops following re-wraps once the cue has ended", async () => {
    vi.useFakeTimers();
    const root = mount(HEADING);
    const resolve = () => root.querySelector<HTMLElement>("#goals");
    flashAnchorTarget(root, resolve);
    vi.advanceTimersByTime(ANCHOR_TARGET_CUE_MS);
    vi.useRealTimers();
    root.innerHTML = HEADING;
    await flush();
    expect(cueOf(resolve()!)).toBeNull();
  });

  it("picks the cue up when the target appears only after a re-wrap", async () => {
    const root = mount(`<p>Loading</p>`);
    const resolve = () => root.querySelector<HTMLElement>("#goals");
    const cancel = flashAnchorTarget(root, resolve);
    root.innerHTML = HEADING;
    await flush();
    expect(cueOf(resolve()!)).not.toBeNull();
    cancel();
  });

  it("cancels cleanly when the target never appeared", () => {
    const root = mount(`<p>Loading</p>`);
    const cancel = flashAnchorTarget(root, () => null);
    expect(() => cancel()).not.toThrow();
    expect(root.innerHTML).toBe("<p>Loading</p>");
  });
});
describe("holdScrollOnTarget", () => {
  let observers: FakeResizeObserver[];
  // Every hold registers document listeners + a timer; release them so one
  // test's hold can't react to the next test's events.
  let cancels: Array<() => void>;

  class FakeResizeObserver {
    observed: Element[] = [];
    disconnected = false;
    constructor(private readonly cb: () => void) {
      observers.push(this);
    }
    observe(el: Element) {
      this.observed.push(el);
    }
    disconnect() {
      this.disconnected = true;
    }
    fire() {
      this.cb();
    }
  }

  beforeEach(() => {
    observers = [];
    cancels = [];
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });

  afterEach(() => {
    cancels.splice(0).forEach((cancel) => cancel());
  });

  function setup() {
    const root = mount(`<h2 id="goals">Goals</h2>`);
    const target = root.querySelector<HTMLElement>("#goals")!;
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    const cancel = holdScrollOnTarget(root, () => target);
    cancels.push(cancel);
    return { root, scroll, cancel, observer: observers[0]! };
  }

  it("ignores the initial observation, then re-aligns on later size changes", () => {
    const { root, scroll, observer } = setup();
    expect(observer.observed).toEqual([root]);
    observer.fire(); // initial report on observe()
    expect(scroll).not.toHaveBeenCalled();
    observer.fire(); // late content (diff decorations, images…) landed
    expect(scroll).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });

  it.each(["wheel", "touchstart", "pointerdown", "keydown"])(
    "releases the hold when the reader takes over (%s)",
    (type) => {
      const { scroll, observer } = setup();
      observer.fire();
      document.dispatchEvent(new Event(type));
      expect(observer.disconnected).toBe(true);
      observer.fire(); // a callback queued before disconnect is ignored
      expect(scroll).not.toHaveBeenCalled();
    },
  );

  it("releases the hold even when the article stops the event", () => {
    const { root, scroll, observer } = setup();
    observer.fire();
    // Captured at the document, before an in-article handler swallows it.
    root.addEventListener("wheel", (e) => e.stopPropagation());
    root.dispatchEvent(new Event("wheel", { bubbles: true }));
    expect(observer.disconnected).toBe(true);
    observer.fire();
    expect(scroll).not.toHaveBeenCalled();
  });

  it("leaves no document listeners behind once released", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const { cancel } = setup();
    cancel();
    const added = add.mock.calls.map(([type, fn]) => [type, fn]);
    const removed = remove.mock.calls.map(([type, fn, opts]) => {
      // Same capture phase it was added in, or the removal is a no-op.
      expect(opts).toBe(true);
      return [type, fn];
    });
    expect(removed).toEqual(added);
    add.mockRestore();
    remove.mockRestore();
  });

  it("keeps holding until the time budget runs out, then releases", () => {
    vi.useFakeTimers();
    const { observer, scroll } = setup();
    observer.fire(); // initial report
    vi.advanceTimersByTime(4999);
    expect(observer.disconnected).toBe(false);
    observer.fire();
    expect(scroll).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(observer.disconnected).toBe(true);
  });

  it("cancel is idempotent and tolerates a vanished target", () => {
    const root = mount(`<h2 id="goals">Goals</h2>`);
    const cancel = holdScrollOnTarget(root, () => null);
    cancels.push(cancel);
    const observer = observers[0]!;
    observer.fire();
    observer.fire(); // target gone (e.g. mid re-wrap) — nothing to scroll
    cancel();
    cancel();
    expect(observer.disconnected).toBe(true);
  });

  it("is a no-op where ResizeObserver is unavailable", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const root = mount(`<h2 id="goals">Goals</h2>`);
    const cancel = holdScrollOnTarget(root, () => null);
    expect(() => cancel()).not.toThrow();
  });
});

describe("flashTextTarget", () => {
  function rangeOver(node: Text, start: number, end: number): Range {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return range;
  }

  it("wraps the text in cue spans, skipping reference content, then unwraps", () => {
    vi.useFakeTimers();
    const root = mount(
      `<p id="p">alpha <em>beta</em><span class="emr-diff-deleted-marker">gone</span> gamma</p>`,
    );
    const p = root.querySelector("#p")!;
    const resolve = () => {
      const range = document.createRange();
      range.setStart(p.firstChild!, 0);
      range.setEnd(p.lastChild!, 6);
      return range;
    };
    const cancel = flashTextTarget(root, resolve);
    const cues = Array.from(root.querySelectorAll("[data-emr-text-cue]"));
    expect(cues.map((c) => c.textContent)).toEqual([
      "alpha ",
      "beta",
      " gamma",
    ]);
    expect(cues.every((c) => c.classList.contains(ANCHOR_TARGET_CLASS))).toBe(
      true,
    );
    expect(currentTextCue(root)).toBe(cues[0]);
    vi.advanceTimersByTime(ANCHOR_TARGET_CUE_MS);
    expect(currentTextCue(root)).toBeNull();
    expect(p.textContent).toBe("alpha betagone gamma");
    cancel();
  });

  it("re-applies after a re-wrap with a negative delay, or not at all if gone", async () => {
    const root = mount(`<p>alpha beta</p>`);
    let present = true;
    const cancel = flashTextTarget(root, () => {
      const node = root.querySelector("p")?.firstChild;
      return present && node instanceof Text ? rangeOver(node, 0, 5) : null;
    });
    // Unrelated churn leaves the cue alone.
    root.append(document.createElement("hr"));
    await Promise.resolve();
    expect(root.querySelectorAll("[data-emr-text-cue]")).toHaveLength(1);

    vi.spyOn(performance, "now").mockReturnValue(performance.now() + 400);
    root.innerHTML = "<p>alpha beta</p>";
    await Promise.resolve();
    const cue = currentTextCue(root)!;
    expect(cue.textContent).toBe("alpha");
    expect(cue.style.animationDelay).toMatch(/^-\d+ms$/);

    present = false;
    root.innerHTML = "<p>alpha beta</p>";
    await Promise.resolve();
    expect(currentTextCue(root)).toBeNull();
    // A second cancel is a no-op.
    cancel();
    cancel();
    vi.restoreAllMocks();
  });

  it("never washes struck-out removed words inside the linked span", () => {
    const root = mount(
      `<p>gate <del class="emr-word-removed">blocks deploys</del><ins class="emr-word-added">pauses releases</ins> when</p>`,
    );
    const p = root.querySelector("p")!;
    const cancel = flashTextTarget(root, () => {
      const range = document.createRange();
      range.setStart(p.firstChild!, 0);
      range.setEnd(p.lastChild!, 5);
      return range;
    });
    expect(
      Array.from(root.querySelectorAll("[data-emr-text-cue]")).map(
        (c) => c.textContent,
      ),
    ).toEqual(["gate ", "pauses releases", " when"]);
    expect(root.querySelector("del [data-emr-text-cue]")).toBeNull();
    cancel();
    expect(p.innerHTML).toContain(
      '<del class="emr-word-removed">blocks deploys</del>',
    );
  });

  it("does nothing when the text can't be found", () => {
    const root = mount(`<p>alpha</p>`);
    const cancel = flashTextTarget(root, () => null);
    expect(currentTextCue(root)).toBeNull();
    cancel();
  });
});
