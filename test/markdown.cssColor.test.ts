import { describe, it, expect } from "vitest";

import { renderMarkdown } from "../src/markdown/render";
import { sanitizeCssColor } from "../src/markdown/render";

describe("sanitizeCssColor", () => {
  it("accepts the hex shapes ADO returns, normalizing to #lowercase", () => {
    expect(sanitizeCssColor("#CC6D00")).toBe("#cc6d00");
    // Leading # is optional (added back).
    expect(sanitizeCssColor("339933")).toBe("#339933");
    expect(sanitizeCssColor("  #Abc  ")).toBe("#abc");
    expect(sanitizeCssColor("#12ab")).toBe("#12ab"); // #rgba
    expect(sanitizeCssColor("#11223344")).toBe("#11223344"); // #rrggbbaa
  });

  it("rejects non-hex lengths so partial values can't leak through", () => {
    expect(sanitizeCssColor("#12")).toBeNull();
    expect(sanitizeCssColor("#12345")).toBeNull();
    expect(sanitizeCssColor("#123456789")).toBeNull();
    expect(sanitizeCssColor("")).toBeNull();
  });

  it("rejects any style-attribute breakout attempt (allow-list, not deny-list)", () => {
    // The old escaper deleted `[<>\"';\\]`; an allow-list fails closed instead,
    // so none of these produce a usable color.
    expect(
      sanitizeCssColor("red;background:url(javascript:alert(1))"),
    ).toBeNull();
    expect(sanitizeCssColor("#fff;} body{display:none")).toBeNull();
    expect(sanitizeCssColor('red" onload="x')).toBeNull();
    expect(sanitizeCssColor("expression(alert(1))")).toBeNull();
    expect(sanitizeCssColor("url(data:text/html,evil)")).toBeNull();
    expect(sanitizeCssColor("rgb(0,0,0)")).toBeNull(); // not a hex shape
  });
});

describe("renderMarkdown — state-color sanitization end to end", () => {
  it("emits a background style only for a valid hex state color", async () => {
    const md =
      "See [#42 Bug](mention://workitem/42?type=Bug&state=Active&stateColor=%23cc293d)";
    const html = await renderMarkdown(md);
    expect(html).toContain("background:#cc293d");
  });

  it("drops the style entirely for a hostile state color (no breakout)", async () => {
    const hostile = encodeURIComponent('red;} body{display:none}"');
    const md = `See [#42 Bug](mention://workitem/42?type=Bug&state=Active&stateColor=${hostile})`;
    const html = await renderMarkdown(md);
    // The state-dot span must carry NO inline style at all, so nothing hostile
    // reaches a `style` attribute. (The raw param may still appear elsewhere as
    // a safely HTML-encoded data-* attribute — that's not a CSS breakout.)
    const dotSpan = /<span class="emr-mention-state-dot"[^>]*><\/span>/.exec(
      html,
    );
    expect(dotSpan).not.toBeNull();
    expect(dotSpan![0]).not.toContain("style=");
    // And there is no inline style carrying the injected declaration anywhere.
    expect(html).not.toMatch(/style="[^"]*display:none/);
    expect(html).not.toMatch(/style="[^"]*background:red/);
  });
});
