import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { MermaidSourceModal } from "./MermaidSourceModal";

const SOURCE = `graph TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Do it]\n  B -->|no| D[Skip]`;

const meta = {
  title: "Components/MermaidSourceModal",
  component: MermaidSourceModal,
  args: {
    source: SOURCE,
    onClose: fn(),
  },
} satisfies Meta<typeof MermaidSourceModal>;

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
    await expect(canvasElement.querySelector(".emr-mermaid-modal")).toBeNull();
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
      ".emr-mermaid-modal-overlay",
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
      await userEvent.click(canvas.getByRole("button", { name: "Copy" }));
      await waitFor(() =>
        expect(canvas.getByRole("button", { name: "Copied" })).toBeTruthy(),
      );
      await waitFor(
        () => expect(canvas.getByRole("button", { name: "Copy" })).toBeTruthy(),
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
      await userEvent.click(canvas.getByRole("button", { name: "Copy" }));
      await waitFor(() =>
        expect(canvas.getByRole("button", { name: "Copy" })).toBeTruthy(),
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
      await userEvent.click(canvas.getByRole("button", { name: "Copy" }));
      await expect(canvas.getByRole("button", { name: "Copy" })).toBeTruthy();
    } finally {
      restore();
    }
  },
};

/**
 * When the diagram changed in the PR, the modal shows a word-level diff of the
 * definition (added tokens highlighted, removed tokens struck through) and the
 * title switches to "Diagram source changes".
 */
export const WithSourceDiff: Story = {
  args: {
    source: "graph TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Ship it]",
    originalSource: "graph TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Do it]",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Title reflects the diff mode.
    await expect(canvas.getByText("Diagram source changes")).toBeTruthy();
    // The changed word is marked added; the old word struck through.
    await waitFor(() => {
      const added = canvasElement.querySelector(".emr-word-added");
      const removed = canvasElement.querySelector(".emr-word-removed");
      expect(added?.textContent).toContain("Ship");
      expect(removed?.textContent).toContain("Do");
    });
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
