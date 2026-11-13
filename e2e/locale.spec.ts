// E2E: host language — the extension renders in the language Azure DevOps
// reports for the user, and falls back to English for languages it doesn't
// ship.
//
// Why this needs the real host: the extension reads the language from
// `SDK.getPageContext().globalization.culture`, which only a real ADO host
// fills in. On Azure DevOps Services that culture follows the browser's
// language (`Accept-Language`), so these tests run the browser in a given
// language — the way users switch — and check what the extension renders.
// Unit tests cover locale resolution and lookup against stubbed inputs.
//
// Every other spec pins the extension to English (see fixtures.ts); this one
// opts out.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { FrameLocator, Page } from "@playwright/test";

import { test, expect } from "./fixtures";

import { E2E } from "./env";
import {
    gotoDocumentsHub,
    hubFrame,
    readAppLocale,
    selectRepoInPicker,
    waitForFrameRoot,
} from "./helpers";

const translationsDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../src/i18n/translations",
);

function translation(locale: string): Record<string, string> {
    return JSON.parse(readFileSync(resolve(translationsDir, `${locale}.json`), "utf8")) as Record<
        string,
        string
    >;
}

/** Open the Documents hub on a rendered document and return its frame. */
async function openHub(page: Page): Promise<FrameLocator> {
    await gotoDocumentsHub(page);
    const frame = hubFrame(page);
    await waitForFrameRoot(frame);
    await selectRepoInPicker(page, frame, E2E.repoA);

    return frame;
}

test.use({ pinnedLocale: null });

test.describe("Host language (real ADO host)", () => {
    test.describe("German browser", () => {
        test.use({ locale: "de-DE" });

        test("renders the extension in German", async ({ page }) => {
            const german = translation("de");
            const frame = await openHub(page);

            await expect.poll(() => readAppLocale(frame), { timeout: 30_000 }).toBe("de");
            await expect(
                frame.getByRole("complementary", { name: german["common.documentNavigation"] }),
            ).toBeVisible();
            await expect(
                frame.getByRole("button", { name: german["navigation.docNav.searchDocuments"] }),
            ).toBeVisible();
            await expect(
                frame.getByRole("toolbar", { name: german["navigation.statusBar.toolbarLabel"] }),
            ).toBeVisible();
        });
    });

    test.describe("Browser in a language the extension doesn't ship", () => {
        test.use({ locale: "it-IT" });

        test("falls back to English", async ({ page }) => {
            const frame = await openHub(page);

            await expect.poll(() => readAppLocale(frame), { timeout: 30_000 }).toBe("en");
            await expect(
                frame.getByRole("complementary", { name: "Document navigation" }),
            ).toBeVisible();
            await expect(frame.getByRole("button", { name: "Search documents" })).toBeVisible();
            await expect(
                frame.getByRole("toolbar", { name: "Reader status and controls" }),
            ).toBeVisible();
        });
    });
});
