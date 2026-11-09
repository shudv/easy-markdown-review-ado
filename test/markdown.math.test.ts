import type { Element, Root } from "hast";
import { unified } from "unified";
import { describe, expect, it, vi } from "vitest";

import { rehypeMathPlaceholder } from "../src/markdown/math";
import { hydrateMath } from "../src/markdown/mathHydrate";
import { renderMarkdown, renderMarkdownSync } from "../src/markdown/render";

const RMS_EQUATION = String.raw`G_{\mathrm{scro}\parallel,\mathrm{RMS}} = \sqrt{\frac{1}{Kn}\sum_{i=1}^{n} g_i^2}`;

describe("renderMarkdown — mathematical notation", () => {
    it("renders ADO-compatible inline math with KaTeX", async () => {
        const html = await renderMarkdown(String.raw`Energy is $E = mc^2$.`);
        const root = document.createElement("div");
        root.innerHTML = html;

        expect(root.querySelector(".emr-math--inline")).not.toBeNull();
        expect(root.querySelector(".katex")).toBeNull();
        expect(html).toMatch(/<p\b[^>]+data-source-line="1"/);

        await hydrateMath(root);
        expect(root.querySelector(".katex")).not.toBeNull();
        expect(root.querySelector("math")).not.toBeNull();
        expect(root.querySelector('[aria-hidden="true"]')).not.toBeNull();
    });

    it("renders a multiline dollar-delimited display equation", async () => {
        const html = await renderMarkdown(`$$\n${RMS_EQUATION}\n$$`);
        const root = document.createElement("div");
        root.innerHTML = html;

        const equation = root.querySelector<HTMLElement>(".emr-math--display")!;
        expect(equation).not.toBeNull();
        expect(html).toMatch(/data-source-line="1"/);
        expect(html).toMatch(/data-source-end-line="3"/);

        await hydrateMath(root);
        expect(equation.querySelector(".katex-display")).not.toBeNull();
        expect(equation.querySelector("msqrt")).not.toBeNull();
        expect(equation.textContent).toContain("∑");
    });

    it("renders a fenced math block as a display equation", async () => {
        const html = await renderMarkdown(
            ["```math", String.raw`F_{\mathrm{scro}\parallel} = \frac{1000n}{d}`, "```"].join("\n"),
        );

        const root = document.createElement("div");
        root.innerHTML = html;

        expect(root.querySelector(".emr-math.emr-math--display")).not.toBeNull();
        expect(html).toMatch(/data-source-line="1"/);
        expect(html).toMatch(/data-source-end-line="3"/);
        expect(html).toContain("1000");
        expect(html).not.toContain('class="language-math"');

        await hydrateMath(root);
        expect(root.querySelector(".katex-display")).not.toBeNull();
    });

    it("emits math placeholders through the synchronous preview path", () => {
        const html = renderMarkdownSync(String.raw`$\sum_{i=1}^{n} g_i^2$`);

        expect(html).toContain("emr-math--inline");
        expect(html).toContain("data-math-src");
        expect(html).not.toContain('class="katex"');
    });

    it("keeps malformed math readable instead of dropping it", async () => {
        const html = await renderMarkdown(String.raw`$$\frac{1000n}d}$$`);
        const root = document.createElement("div");
        root.innerHTML = html;
        const equation = root.querySelector<HTMLElement>(".emr-math")!;

        await hydrateMath(root);

        expect(equation.dataset.mathError).toBe("render-failed");
        // Still marked hydrated, or every later pass would retry a deterministic
        // failure.
        expect(equation.dataset.hydrated).toBe("true");
        expect(equation.querySelector(".emr-math-fallback")?.textContent).toBe(
            String.raw`\frac{1000n}d}`,
        );
    });

    it("does not enable KaTeX trusted link commands", async () => {
        const html = await renderMarkdown(String.raw`$\href{javascript:alert(1)}{unsafe}$`);

        const root = document.createElement("div");
        root.innerHTML = html;
        await hydrateMath(root);

        expect(root.querySelector("a")).toBeNull();
        expect(root.querySelector("[href]")).toBeNull();
    });

    it("preserves host controls while replacing the equation fallback", async () => {
        const root = document.createElement("div");
        root.innerHTML = renderMarkdownSync(String.raw`$$x^2$$`);
        const equation = root.querySelector<HTMLElement>(".emr-math")!;
        const control = document.createElement("button");
        control.className = "host-control";
        equation.prepend(control);

        await hydrateMath(root);

        expect(equation.querySelector(".host-control")).toBe(control);
        expect(equation.querySelector(".emr-math-fallback")).toBeNull();
        expect(equation.querySelector(".katex")).not.toBeNull();
    });

    it("marks an invalid encoded source without replacing its fallback", async () => {
        const root = document.createElement("div");
        root.innerHTML =
            '<span class="emr-math" data-math-src="%" data-math-display="false">' +
            '<code class="emr-math-fallback">%</code></span>';

        await hydrateMath(root);

        const equation = root.querySelector<HTMLElement>(".emr-math")!;
        expect(equation.dataset.mathError).toBe("invalid-source");
        expect(equation.querySelector(".emr-math-fallback")?.textContent).toBe("%");
    });

    it("leaves a placeholder with an empty source as its fallback, neither rendered nor flagged", async () => {
        const root = document.createElement("div");
        root.innerHTML =
            '<span class="emr-math" data-math-src=""><code class="emr-math-fallback"></code></span>';

        await hydrateMath(root);

        const equation = root.querySelector<HTMLElement>(".emr-math")!;
        expect(equation.querySelector(".emr-math-fallback")).not.toBeNull();
        expect(equation.querySelector(".katex")).toBeNull();
        expect(equation.dataset.hydrated).toBeUndefined();
        expect(equation.dataset.mathError).toBeUndefined();
    });

    it("appends rendered math when a placeholder has no source fallback", async () => {
        const root = document.createElement("div");
        root.innerHTML = `<span class="emr-math" data-math-src="${encodeURIComponent("x^2")}" data-math-display="false"></span>`;

        await hydrateMath(root);

        expect(root.querySelector(".emr-math > .katex")).not.toBeNull();
    });

    it("leaves an already rendered equation as is, without loading KaTeX again", async () => {
        const root = document.createElement("div");
        root.innerHTML = renderMarkdownSync(String.raw`$x^2$`);
        await hydrateMath(root);
        const equation = root.querySelector<HTMLElement>(".emr-math")!;
        const rendered = equation.innerHTML;
        const loadKatex = vi.fn();

        await hydrateMath(root, loadKatex);

        expect(loadKatex).not.toHaveBeenCalled();
        expect(equation.innerHTML).toBe(rendered);
    });
});

// The un-hydrated placeholder is a contract, not an implementation detail:
// `hydrateMath` replaces `:scope > .emr-math-fallback`, the anchor layer refuses
// to anchor inside `.emr-math`, and the fallback is what a reader sees when
// KaTeX is still loading or failed to load.
describe("rehypeMathPlaceholder — placeholder contract", () => {
    function render(markdown: string): HTMLElement {
        const root = document.createElement("div");
        root.innerHTML = renderMarkdownSync(markdown);

        return root;
    }

    it("wraps a display equation's source in a <pre><code> fallback", () => {
        const host = render("$$\nx^2\n$$").querySelector<HTMLElement>(".emr-math--display")!;

        expect(host.tagName).toBe("DIV");
        expect(host.dataset.mathDisplay).toBe("true");
        expect(decodeURIComponent(host.dataset.mathSrc!)).toBe("x^2");

        const fallback = host.querySelector<HTMLElement>(":scope > pre.emr-math-fallback")!;

        expect(fallback).not.toBeNull();
        expect(fallback.querySelector("code")?.textContent).toBe("x^2");
    });

    it("wraps an inline equation's source in a <code> fallback", () => {
        const host =
            render("Energy is $E = mc^2$.").querySelector<HTMLElement>(".emr-math--inline")!;

        expect(host.tagName).toBe("SPAN");
        expect(host.dataset.mathDisplay).toBe("false");
        expect(
            host.querySelector<HTMLElement>(":scope > code.emr-math-fallback")?.textContent,
        ).toBe("E = mc^2");
    });

    it("leaves ordinary inline code alone", () => {
        const root = render("Run `npm run build` to ship.");

        expect(root.querySelector(".emr-math")).toBeNull();
        expect(root.querySelector("code")?.textContent).toBe("npm run build");
    });

    it("keeps interior blank lines in a fenced block and trims only the trailing ones", () => {
        const host = render(
            ["```math", "a + b", "", "c + d", "", "```"].join("\n"),
        ).querySelector<HTMLElement>(".emr-math--display")!;

        expect(decodeURIComponent(host.dataset.mathSrc!)).toBe("a + b\n\nc + d");
    });
});

describe("rehypeMathPlaceholder — non-pipeline input", () => {
    function run(children: Root["children"]): Root {
        return unified().use(rehypeMathPlaceholder).runSync({ type: "root", children });
    }

    function mathCode(className: string, value: string): Element {
        return {
            type: "element",
            tagName: "code",
            properties: { className: [className] },
            children: value ? [{ type: "text", value }] : [],
        };
    }

    it("omits source-line attributes when the math node has none", () => {
        const tree = run([mathCode("math-inline", "x")]);
        const host = tree.children[0] as Element;
        expect(host.properties.className).toContain("emr-math--inline");
        expect(host.properties).not.toHaveProperty("dataSourceLine");
        expect(host.properties).not.toHaveProperty("dataSourceEndLine");
    });

    it("leaves a <pre> without a <code> child alone", () => {
        const pre: Element = {
            type: "element",
            tagName: "pre",
            properties: {},
            children: [{ type: "text", value: "x^2" }],
        };

        expect(run([pre]).children[0]).toBe(pre);
    });

    it("leaves an empty inline math node alone", () => {
        const code = mathCode("math-inline", "");
        expect(run([code]).children[0]).toBe(code);
    });

    it("keeps an empty fenced math block as an ordinary code block", () => {
        const root = document.createElement("div");
        root.innerHTML = renderMarkdownSync("```math\n```");
        expect(root.querySelector(".emr-math")).toBeNull();
        expect(root.querySelector("pre > code")).not.toBeNull();
    });
});
