import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { tRich } from "../src/i18n/rich";

describe("tRich", () => {
    it("fills placeholders with React nodes", () => {
        const html = renderToStaticMarkup(
            tRich("hub.prTab.reconnecting.expiredSignIn", { eta: <b>soon</b> }),
        );

        expect(html).toContain("continue by itself <b>soon</b>.");
    });

    it("formats a numeric count and picks its plural form", () => {
        expect(renderToStaticMarkup(tRich("hub.prTab.eta.aboutMinutes", { count: 1234 }))).toBe(
            "within about 1,234 minutes",
        );
    });

    it("renders a message without placeholders", () => {
        expect(renderToStaticMarkup(tRich("common.cancel"))).toBe("Cancel");
    });
});
