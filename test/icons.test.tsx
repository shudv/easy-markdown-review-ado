// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlusIcon, SearchIcon } from "../src/shell/components/icons";

describe("shared toolbar icons", () => {
    it.each([
        { name: "search", icon: <SearchIcon /> },
        { name: "plus", icon: <PlusIcon /> },
    ])("draws the $name icon at the toolbar's default size and stroke", ({ icon }) => {
        const markup = renderToStaticMarkup(icon);

        expect(markup).toContain('class="emr-ui-icon"');
        expect(markup).toContain('width="16"');
        expect(markup).toContain('stroke-width="1.75"');
    });

    it("lets a caller resize an icon and add its own class", () => {
        const markup = renderToStaticMarkup(<PlusIcon size={18} className="custom-icon" />);

        expect(markup).toContain('class="emr-ui-icon custom-icon"');
        expect(markup).toContain('width="18"');
        expect(markup).toContain('stroke-width="1.75"');
    });
});
