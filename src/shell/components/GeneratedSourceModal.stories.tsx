import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { GeneratedSourceModal } from "./GeneratedSourceModal";

const SOURCE = `graph TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Do it]\n  B -->|no| D[Skip]`;

// Mermaid and KaTeX are lazily imported, so any wait on a (re)rendered preview
// needs far more headroom than testing-library's 1s default once the suite is
// running browser stories in parallel.
const LAZY_RENDER = { timeout: 15000 };

const meta = {
  title: "Components/GeneratedSourceModal",
  component: GeneratedSourceModal,
  args: {
    source: SOURCE,
    onClose: fn(),
  },
} satisfies Meta<typeof GeneratedSourceModal>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Override navigator.clipboard for the duration of a play function. */
function stubClipboard(impl: { writeText: () => Promise<void> } | undefined) {
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    value: impl,
    configurable: true,
  });
  return () => {
    if (original) Object.defineProperty(navigator, "clipboard", original);
  };
}

export const Open: Story = {};

/** A null source renders nothing. */
export const Closed: Story = {
  args: { source: null },
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelector(".emr-generated-source-modal"),
    ).toBeNull();
  },
};

export const ClosesOnEscape: Story = {
  play: async ({ args }) => {
    // A non-Escape key is ignored; Escape closes.
    await userEvent.keyboard("a");
    await expect(args.onClose).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    await expect(args.onClose).toHaveBeenCalledTimes(1);
  },
};

export const ClosesOnOverlayClick: Story = {
  play: async ({ args, canvasElement }) => {
    const overlay = canvasElement.querySelector<HTMLElement>(
      ".emr-generated-source-overlay",
    )!;
    await userEvent.click(overlay);
    await expect(args.onClose).toHaveBeenCalledTimes(1);
  },
};

export const ClosesOnButton: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Close" }));
    await expect(args.onClose).toHaveBeenCalledTimes(1);
  },
};

/** Copy succeeds → label flips to "Copied" then reverts. */
export const CopySucceeds: Story = {
  play: async ({ canvasElement }) => {
    const restore = stubClipboard({ writeText: () => Promise.resolve() });
    try {
      const canvas = within(canvasElement);
      await userEvent.click(
        canvas.getByRole("button", { name: "Copy source" }),
      );
      await waitFor(() =>
        expect(canvas.getByRole("button", { name: "Copied" })).toBeTruthy(),
      );
      await waitFor(
        () =>
          expect(
            canvas.getByRole("button", { name: "Copy source" }),
          ).toBeTruthy(),
        { timeout: 2500 },
      );
    } finally {
      restore();
    }
  },
};

/** Copy is rejected → label stays "Copy" (failure is swallowed). */
export const CopyFails: Story = {
  play: async ({ canvasElement }) => {
    const restore = stubClipboard({
      writeText: () => Promise.reject(new Error("blocked")),
    });
    try {
      const canvas = within(canvasElement);
      await userEvent.click(
        canvas.getByRole("button", { name: "Copy source" }),
      );
      await waitFor(() =>
        expect(
          canvas.getByRole("button", { name: "Copy source" }),
        ).toBeTruthy(),
      );
    } finally {
      restore();
    }
  },
};

/** Copy stays graceful when no clipboard API is available (no error thrown). */
export const CopyWithoutClipboard: Story = {
  play: async ({ canvasElement }) => {
    const restore = stubClipboard(undefined);
    try {
      const canvas = within(canvasElement);
      await userEvent.click(
        canvas.getByRole("button", { name: "Copy source" }),
      );
      await expect(
        canvas.getByRole("button", { name: "Copy source" }),
      ).toBeTruthy();
    } finally {
      restore();
    }
  },
};

/**
 * When the diagram changed in the PR, Changes shows a word-level source diff
 * and Before switches both source and preview to the previous diagram.
 */
export const WithSourceDiff: Story = {
  args: {
    source: "graph TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Ship it]",
    originalSource: "graph TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Do it]",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Diagram source")).toBeTruthy();
    await expect(
      canvas.getByRole("button", { name: "Hide source changes" }),
    ).toHaveAttribute("aria-pressed", "true");
    // The changed word is marked added; the old word struck through.
    await waitFor(() => {
      const added = canvasElement.querySelector(".emr-word-added");
      const removed = canvasElement.querySelector(".emr-word-removed");
      expect(added?.textContent).toContain("Ship");
      expect(removed?.textContent).toContain("Do");
    });
    await userEvent.click(
      canvas.getByRole("button", { name: "Hide source changes" }),
    );
    await expect(canvasElement.querySelector(".emr-word-added")).toBeNull();
    await expect(
      canvas.getByRole("button", { name: "Show source changes" }),
    ).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(
      canvas.getByRole("button", { name: "Show source changes" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Before" }));
    await expect(
      canvas.queryByRole("button", { name: /source changes/i }),
    ).toBeNull();
    await waitFor(
      () => {
        expect(
          canvasElement.querySelector(".emr-generated-source-code code")
            ?.textContent,
        ).toBe("graph TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Do it]");
        const preview = canvasElement.querySelector<HTMLElement>(
          ".emr-generated-source-preview .emr-mermaid",
        );
        expect(preview?.dataset.mermaidSrc).toBe(
          encodeURIComponent(
            "graph TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Do it]",
          ),
        );
        expect(preview?.dataset.hydrated).toBe("true");
      },
      // Switching to Before re-renders through Mermaid, which is lazily
      // imported — too slow for the 1s default when the suite runs in parallel.
      LAZY_RENDER,
    );
  },
};

/**
 * The overlay centres the callout, so a content-driven resize would shift the
 * header out from under the pointer that just clicked a toggle.
 */
export const StableHeightAcrossToggles: Story = {
  args: {
    source:
      "graph TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Ship it]\n  B -->|no| D[Skip]\n  C --> E[Done]\n  D --> E",
    originalSource: "graph TD\n  A[Start] --> B{Go}",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const modal = canvasElement.querySelector<HTMLElement>(
      ".emr-generated-source-modal",
    )!;
    const hydratedSrc = () =>
      canvasElement.querySelector<HTMLElement>(
        '.emr-generated-source-preview .emr-mermaid[data-hydrated="true"]',
      )?.dataset.mermaidSrc;
    await waitFor(() => expect(hydratedSrc()).toBeTruthy(), LAZY_RENDER);

    // The frame height is keyed off this, so a diagram would silently get the
    // shorter equation frame if it went missing.
    await expect(
      modal.querySelector<HTMLElement>(".emr-generated-source-body")?.dataset
        .kind,
    ).toBe("mermaid");

    const baseline = modal.getBoundingClientRect();
    const measure = () => {
      const { height, top } = modal.getBoundingClientRect();
      expect(height).toBe(baseline.height);
      expect(top).toBe(baseline.top);
    };

    await userEvent.click(
      canvas.getByRole("button", { name: "Hide source changes" }),
    );
    measure();
    await userEvent.click(
      canvas.getByRole("button", { name: "Show source changes" }),
    );
    measure();
    await userEvent.click(canvas.getByRole("button", { name: "Before" }));
    await waitFor(
      () =>
        expect(hydratedSrc()).toBe(
          encodeURIComponent("graph TD\n  A[Start] --> B{Go}"),
        ),
      LAZY_RENDER,
    );
    measure();
  },
};

/**
 * A removal that is only punctuation (here a trailing period in a node label)
 * has no ink at strike height, so it renders "tight" — no strikethrough, just
 * the red tint — the same rule the article uses.
 */
export const WithPunctuationRemoval: Story = {
  args: {
    source: "graph TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Do it]",
    originalSource:
      "graph TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Do it.]",
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const tight = canvasElement.querySelector(".emr-word-removed--tight");
      expect(tight?.textContent).toBe(".");
    });
  },
};

/** An identical original source shows no diff (plain source, normal title). */
export const UnchangedSource: Story = {
  args: {
    source: SOURCE,
    originalSource: SOURCE,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Diagram source")).toBeTruthy();
    await expect(canvasElement.querySelector(".emr-word-added")).toBeNull();
  },
};

export const EquationSourceDiff: Story = {
  args: {
    kind: "math",
    source: String.raw`G_{\mathrm{RMS}} = \sqrt{\sum_{i=1}^{n} g_i^2}`,
    originalSource: String.raw`G_{\mathrm{RMS}} = \sqrt{\sum_{i=1}^{n} g_i}`,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Equation source")).toBeTruthy();
    await waitFor(() => {
      expect(
        canvasElement.querySelector(".emr-generated-source-preview .katex"),
      ).toBeTruthy();
      expect(canvasElement.querySelector(".emr-word-added")?.textContent).toBe(
        "^2",
      );
    }, LAZY_RENDER);
    await userEvent.click(canvas.getByRole("button", { name: "Before" }));
    await expect(
      canvas.getByRole("button", { name: "Before" }),
    ).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => {
      expect(
        canvasElement.querySelector(".emr-generated-source-code code")
          ?.textContent,
      ).toBe(String.raw`G_{\mathrm{RMS}} = \sqrt{\sum_{i=1}^{n} g_i}`);
      expect(
        canvasElement.querySelector(".emr-generated-source-preview annotation")
          ?.textContent,
      ).toBe(String.raw`G_{\mathrm{RMS}} = \sqrt{\sum_{i=1}^{n} g_i}`);
    }, LAZY_RENDER);
    await userEvent.click(canvas.getByRole("button", { name: "Before" }));
    await expect(
      canvas.getByRole("button", { name: "Hide source changes" }),
    ).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => {
      expect(
        canvasElement.querySelector(".emr-generated-source-code code")
          ?.textContent,
      ).toBe(String.raw`G_{\mathrm{RMS}} = \sqrt{\sum_{i=1}^{n} g_i^2}`);
      expect(
        canvasElement.querySelector(".emr-generated-source-preview annotation")
          ?.textContent,
      ).toBe(String.raw`G_{\mathrm{RMS}} = \sqrt{\sum_{i=1}^{n} g_i^2}`);
    }, LAZY_RENDER);
  },
};

export const EquationSource: Story = {
  args: {
    kind: "math",
    source: String.raw`G_{\mathrm{scroll},\mathrm{RMS}} = \sqrt{\frac{1}{Kn}\sum_{i=1}^{n} g_i}`,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Equation source")).toBeTruthy();
    await waitFor(
      () =>
        expect(
          canvasElement.querySelector(".emr-generated-source-preview .katex"),
        ).toBeTruthy(),
      LAZY_RENDER,
    );
    // An equation that fits must not scroll: the radical's tail overhangs, so a
    // shrink-wrapped host would show a scrollbar with room to spare.
    for (const selector of [
      ".emr-generated-source-preview .emr-math",
      ".emr-generated-source-preview .katex-display",
    ]) {
      const el = canvasElement.querySelector<HTMLElement>(selector)!;
      expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth);
    }
    await expect(
      canvasElement.querySelector<HTMLElement>(".emr-generated-source-body")
        ?.dataset.kind,
    ).toBe("math");
  },
};

export const EquationCopySucceeds: Story = {
  args: {
    kind: "math",
    source: String.raw`x^2`,
  },
  play: async ({ canvasElement }) => {
    const restore = stubClipboard({ writeText: () => Promise.resolve() });
    try {
      const canvas = within(canvasElement);
      await userEvent.click(
        canvas.getByRole("button", { name: "Copy source" }),
      );
      await waitFor(() =>
        expect(canvas.getByRole("button", { name: "Copied" })).toBeTruthy(),
      );
    } finally {
      restore();
    }
  },
};
