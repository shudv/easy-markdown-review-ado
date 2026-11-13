import { beforeEach, describe, expect, it } from "vitest";

import { bootErrorHeading, bootErrorDetail, renderBootErrorInto } from "../src/shell/bootError";

function errorWithStack(message: string, stack: string | undefined): Error {
    const error = new Error(message);
    error.stack = stack;

    return error;
}

describe("bootErrorDetail", () => {
    it.each([
        {
            name: "shows the stack of an Error that has one",
            thrown: errorWithStack("boom", "Error: boom\n  at x"),
            expected: "Error: boom\n  at x",
        },
        {
            name: "falls back to the message of an Error without a stack",
            thrown: errorWithStack("just a message", undefined),
            expected: "just a message",
        },
        {
            name: "falls back to the message when the stack is empty, rather than showing a blank panel",
            thrown: errorWithStack("host refused", ""),
            expected: "host refused",
        },
        { name: "shows a thrown string as-is", thrown: "plain string", expected: "plain string" },
        { name: "stringifies a thrown number", thrown: 42, expected: "42" },
        { name: "stringifies a thrown null", thrown: null, expected: "null" },
    ])("$name", ({ thrown, expected }) => {
        expect(bootErrorDetail(thrown)).toBe(expected);
    });
});

describe("renderBootErrorInto", () => {
    let root: HTMLElement;

    beforeEach(() => {
        root = document.createElement("div");
    });

    it("shows the failure heading above the error detail", () => {
        renderBootErrorInto(root, "something broke");

        expect(root.querySelector("h2")?.textContent).toBe("Markdown Review failed to load");
        expect(root.querySelector("pre")?.textContent).toBe("something broke");
    });

    it("does not interpret HTML in the detail (no injection)", () => {
        const hostile = '<img src=x onerror="alert(1)"><script>evil()</script>';

        renderBootErrorInto(root, hostile);

        // The hostile markup must appear as literal TEXT, not as parsed nodes.
        expect(root.querySelector("img")).toBeNull();
        expect(root.querySelector("script")).toBeNull();
        expect(root.querySelector("pre")?.textContent).toBe(hostile);
    });

    it("replaces the loading content that was showing", () => {
        root.innerHTML = "<span>stale spinner</span>";

        renderBootErrorInto(root, "fresh error");

        expect(bootErrorHeading()).toBe("Markdown Review failed to load");
        expect(root.textContent).toBe(`${bootErrorHeading()}fresh error`);
    });
});
