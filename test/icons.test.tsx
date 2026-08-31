// @vitest-environment jsdom

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlusIcon, SearchIcon } from "../src/shell/components/icons";

describe("shared toolbar icons", () => {
  it("uses matching defaults and composes optional classes", () => {
    const search = renderToStaticMarkup(<SearchIcon />);
    const plusDefault = renderToStaticMarkup(<PlusIcon />);
    const plus = renderToStaticMarkup(
      <PlusIcon size={18} className="custom-icon" />,
    );

    expect(search).toContain('class="emr-ui-icon"');
    expect(search).toContain('width="16"');
    expect(search).toContain('stroke-width="1.75"');
    expect(plusDefault).toContain('width="16"');
    expect(plus).toContain('class="emr-ui-icon custom-icon"');
    expect(plus).toContain('width="18"');
    expect(plus).toContain('stroke-width="1.75"');
  });
});
