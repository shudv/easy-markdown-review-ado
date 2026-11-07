import { describe, it, expect } from "vitest";

import { renderMarkdown, sanitizeCssColor } from "../src/markdown/render";

// Work-item state colours come from ADO and end up in a `style` attribute on the
// mention's state dot, so only plain hex colours may pass.
describe("sanitizeCssColor", () => {
    it.each([
        { name: "an upper-case #rrggbb from ADO", input: "#CC6D00", expected: "#cc6d00" },
        { name: "an rrggbb without the leading #", input: "339933", expected: "#339933" },
        { name: "a #rgb padded with whitespace", input: "  #Abc  ", expected: "#abc" },
        { name: "an #rgba", input: "#12ab", expected: "#12ab" },
        { name: "an #rrggbbaa", input: "#11223344", expected: "#11223344" },
    ])("accepts $name as lower-case hex", ({ input, expected }) => {
        expect(sanitizeCssColor(input)).toBe(expected);
    });

    it.each([
        { name: "an empty value", input: "" },
        { name: "a named colour", input: "red" },
        { name: "an rgb() function", input: "rgb(0,0,0)" },
        { name: "a non-hex digit", input: "#gggggg" },
        { name: "a 2-digit hex", input: "#12" },
        { name: "a 5-digit hex", input: "#12345" },
        { name: "a 7-digit hex", input: "#1234567" },
        { name: "a 9-digit hex", input: "#123456789" },
        { name: "a declaration breakout", input: "red;background:url(javascript:alert(1))" },
        { name: "a rule breakout", input: "#fff;} body{display:none" },
        { name: "an attribute breakout", input: 'red" onload="x' },
        { name: "a CSS expression", input: "expression(alert(1))" },
        { name: "a data URL", input: "url(data:text/html,evil)" },
    ])("rejects $name", ({ input }) => {
        expect(sanitizeCssColor(input)).toBeNull();
    });
});

describe("renderMarkdown — work-item state colour", () => {
    it("colours the state dot with a valid hex state colour", async () => {
        const md =
            "See [#42 Bug](mention://workitem/42?type=Bug&state=Active&stateColor=%23cc293d)";

        const html = await renderMarkdown(md);
        expect(html).toContain("background:#cc293d");
    });

    it("renders the state dot without any inline style for a hostile state colour", async () => {
        const hostile = encodeURIComponent('red;} body{display:none}"');
        const md = `See [#42 Bug](mention://workitem/42?type=Bug&state=Active&stateColor=${hostile})`;
        const html = await renderMarkdown(md);

        // The raw param may still appear as a safely HTML-encoded data-* attribute;
        // what matters is that nothing reaches a `style` attribute.
        const dotSpan = /<span class="emr-mention-state-dot"[^>]*><\/span>/.exec(html);

        expect(dotSpan?.[0]).toBeDefined();
        expect(dotSpan?.[0]).not.toContain("style=");
        expect(html).not.toMatch(/style="[^"]*display:none/);
    });
});
