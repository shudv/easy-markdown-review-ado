// Unit tests for the shared JSON-list store (src/shell/storedList.ts) behind
// this browser's caches: whole-list writes, and every storage failure read as
// an empty list or a skipped write.
//
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { isRecord, readStoredList, writeStoredList } from "../src/shell/storedList";

const KEY = "emr.test.list";
const isNumber = (value: unknown): value is number => typeof value === "number";

afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
});

describe("storedList", () => {
    it("reads back the list it wrote", () => {
        writeStoredList(KEY, [1, 2, 3]);

        expect(readStoredList(KEY, isNumber)).toEqual([1, 2, 3]);
    });

    it("reads nothing before anything is written", () => {
        expect(readStoredList(KEY, isNumber)).toEqual([]);
    });

    it("keeps only the items the check accepts", () => {
        window.localStorage.setItem(KEY, JSON.stringify([1, "two", null, 3]));

        expect(readStoredList(KEY, isNumber)).toEqual([1, 3]);
    });

    it.each([
        { name: "not JSON", raw: "[1," },
        { name: "not a list", raw: JSON.stringify({ 0: 1 }) },
    ])("reads stored data that is $name as empty", ({ raw }) => {
        window.localStorage.setItem(KEY, raw);

        expect(readStoredList(KEY, isNumber)).toEqual([]);
    });

    it("reads blocked storage as empty", () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("SecurityError");
        });

        expect(readStoredList(KEY, isNumber)).toEqual([]);
    });

    it("leaves the old list when storage refuses the write", () => {
        writeStoredList(KEY, [1]);
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new DOMException("full", "QuotaExceededError");
        });

        expect(() => writeStoredList(KEY, [2])).not.toThrow();
        vi.restoreAllMocks();
        expect(readStoredList(KEY, isNumber)).toEqual([1]);
    });
});

describe("isRecord", () => {
    it.each([
        [{}, true],
        [[], true],
        [null, false],
        ["x", false],
    ])("%j is a record: %s", (value, expected) => {
        expect(isRecord(value)).toBe(expected);
    });
});
