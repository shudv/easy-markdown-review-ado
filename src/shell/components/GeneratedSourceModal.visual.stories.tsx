// Visual-regression fixtures for the shared generated-source callout.
//
// The equation side is pinned by `ArticleView.visual.stories.tsx`; this file
// pins the MERMAID side, which routes through the same header, toggles and
// preview pane. Mermaid layout is deterministic for a fixed input inside the
// pinned Playwright image, and the shots are cropped to the modal.
//
// Screenshotted by visual/curated.visual.spec.ts.

import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { fn, waitFor } from "storybook/test";

import { GeneratedSourceModal } from "./GeneratedSourceModal";

const CURRENT = `graph TD\n  A[Draft] --> B{Review}\n  B -->|approve| C[Ship it]\n  B -->|changes| A`;
const ORIGINAL = `graph TD\n  A[Draft] --> B{Review}\n  B -->|approve| C[Do it]\n  B -->|changes| A`;

/** Applies an EMR theme to the document root for the story's lifetime. */
function ThemeRoot({
  theme,
  children,
}: {
  theme?: "dark" | "hc-light" | "hc-dark";
  children: React.ReactNode;
}): React.ReactElement {
  React.useLayoutEffect(() => {
    const el = document.documentElement;
    const prev = el.getAttribute("data-emr-theme");
    if (theme) el.setAttribute("data-emr-theme", theme);
    else el.removeAttribute("data-emr-theme");
    return () => {
      if (prev) el.setAttribute("data-emr-theme", prev);
      else el.removeAttribute("data-emr-theme");
    };
  }, [theme]);
  return (
    <div style={{ background: "var(--emr-bg)", height: "100vh" }}>
      {children}
    </div>
  );
}

function themeDecorator(
  theme?: "dark" | "hc-light" | "hc-dark",
): (Story: React.ComponentType) => React.ReactElement {
  return (Story) => (
    <ThemeRoot theme={theme}>
      <Story />
    </ThemeRoot>
  );
}

/**
 * Wait for the diagram to hydrate AND to occupy real space. The preview renders
 * outside `.emr-rendered`, so a missing style scope silently collapses the SVG
 * to zero width even though it hydrated — assert the box, not just the node.
 */
async function settleDiagram(
  canvasElement: HTMLElement,
): Promise<SVGSVGElement> {
  return await waitFor(
    () => {
      const host = canvasElement.ownerDocument.querySelector<HTMLElement>(
        '.emr-generated-source-preview .emr-mermaid[data-hydrated="true"]',
      );
      const svg = host?.querySelector<SVGSVGElement>(":scope > svg");
      if (!host || !svg) throw new Error("diagram preview did not hydrate");
      // Hydration strips the SVG's width/height attributes, so the diagram is
      // sized purely by the `.emr-mermaid` rules. If those are not in scope the
      // browser falls back to the 300x150 default instead of the natural width.
      if (getComputedStyle(host).display !== "flex") {
        throw new Error("diagram preview is missing `.emr-mermaid` styling");
      }
      const natural = host.style.getPropertyValue("--emr-diagram-natural-w");
      const expected = Math.min(
        parseFloat(natural),
        host.getBoundingClientRect().width,
      );
      const actual = svg.getBoundingClientRect().width;
      if (!natural || Math.abs(actual - expected) > 2) {
        throw new Error(
          `diagram preview is ${actual}px wide, expected ~${expected}px`,
        );
      }
      return svg;
    },
    { timeout: 15000 },
  );
}

const meta = {
  title: "Visual/GeneratedSource",
  component: GeneratedSourceModal,
  parameters: { layout: "fullscreen" },
  args: {
    source: CURRENT,
    onClose: fn(),
  },
} satisfies Meta<typeof GeneratedSourceModal>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Unchanged diagram: identity icon, title, Copy and Close only. */
export const DiagramSourceLight: Story = {
  decorators: [themeDecorator()],
  play: async ({ canvasElement }) => {
    await settleDiagram(canvasElement);
  },
};

export const DiagramSourceDark: Story = {
  decorators: [themeDecorator("dark")],
  play: async ({ canvasElement }) => {
    await settleDiagram(canvasElement);
  },
};

/** Edited diagram: Changes is active, so the source pane is word-diffed. */
export const DiagramSourceDiff: Story = {
  decorators: [themeDecorator()],
  args: { source: CURRENT, originalSource: ORIGINAL },
  play: async ({ canvasElement }) => {
    await settleDiagram(canvasElement);
    await waitFor(() => {
      const added = canvasElement.ownerDocument.querySelector(
        ".emr-generated-source-code-diff .emr-word-added",
      );
      if (added?.textContent !== "Ship") {
        throw new Error("diagram source diff did not settle");
      }
    });
  },
};

export const DiagramSourceDiffDark: Story = {
  decorators: [themeDecorator("dark")],
  args: { source: CURRENT, originalSource: ORIGINAL },
  play: async ({ canvasElement }) => {
    await DiagramSourceDiff.play!({ canvasElement } as never);
  },
};

/** Before: the header drops Changes and the preview redraws the old diagram. */
export const DiagramSourceBefore: Story = {
  decorators: [themeDecorator()],
  args: { source: CURRENT, originalSource: ORIGINAL },
  play: async ({ canvasElement }) => {
    await settleDiagram(canvasElement);
    const before = canvasElement.ownerDocument.querySelector<HTMLButtonElement>(
      '.emr-generated-source-before[aria-pressed="false"]',
    )!;
    before.click();
    await waitFor(() => {
      const preview = canvasElement.ownerDocument.querySelector<HTMLElement>(
        ".emr-generated-source-preview .emr-mermaid",
      );
      if (preview?.dataset.mermaidSrc !== encodeURIComponent(ORIGINAL)) {
        throw new Error("preview did not switch to the previous diagram");
      }
    });
    await settleDiagram(canvasElement);
  },
};
