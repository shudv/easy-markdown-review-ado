import type { Preview } from "@storybook/react-vite";

// Load the same global stylesheet the standalone dev preview and the
// shipped bundle use, so stories render with the real component styles.
import "../src/shell/styles.scss";

const preview: Preview = {
  parameters: {
    layout: "padded",
    controls: {
      expanded: true,
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
