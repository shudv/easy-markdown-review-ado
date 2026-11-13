import type { Preview } from "@storybook/react-vite";

import { initLocale } from "../src/i18n/i18n";
import { SUPPORTED_LOCALES } from "../src/i18n/locales";

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
    // Toolbar switch to review every story in each shipped UI language.
    globalTypes: {
        locale: {
            description: "UI language",
            toolbar: {
                title: "Language",
                icon: "globe",
                items: [...SUPPORTED_LOCALES],
                dynamicTitle: true,
            },
        },
    },
    initialGlobals: { locale: "en" },
    loaders: [
        async ({ globals }) => {
            await initLocale({ override: globals.locale as string | undefined });

            return {};
        },
    ],
};

export default preview;
