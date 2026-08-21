// E2E: relative Markdown-link routing in the live Documents hub and PR tab.
//
// Why this needs the real host: the pure routing decision (src/markdown/
// docLinks.ts) is unit-tested and the in-reader scroll/select behaviour is
// covered by Storybook, but the half that talks to ADO is only exercised inside
// a real contribution iframe against a real collection:
//   * swapping the hosted reader in place and mirroring `?path=` onto the host
//     URL via HostNavigationService.setQueryParams,
//   * handing a non-Markdown link to ADO's Files view via
//     HostNavigationService.openNewWindow with a URL built by buildReposFileUrl,
//     and
//   * handing a Markdown link that points OUTSIDE the open PR to the Documents
//     hub in a new tab, with a URL built by buildHubDocUrl.
// This drives the `doc-links-showcase` sandbox repo
// (sandbox/repos/doc-links-showcase), whose nested docs link to each other and
// to a non-Markdown asset, plus its active "expand guides" PR.

import { test, expect, type Page } from "@playwright/test";
import { E2E } from "./env";
import {
  discoverPullRequestId,
  expectReaderHeading,
  gotoDocumentsHub,
  gotoPrTab,
  hubFrame,
  prTabFrame,
  selectRepoInPicker,
  waitForFrameRoot,
} from "./helpers";

test.describe("Relative doc links (real ADO host)", () => {
  // Learn the repo GUID via the picker (the only name→GUID bridge without an
  // authenticated API call) then deep-link straight to the index doc that
  // carries the links. Shared by both tests.
  async function openLinkIndexDoc(page: Page) {
    await gotoDocumentsHub(page);
    await waitForFrameRoot(hubFrame(page));
    const repo = await selectRepoInPicker(
      page,
      hubFrame(page),
      E2E.docLinksRepo,
    );
    await gotoDocumentsHub(page, {
      repo,
      path: E2E.docLinksDoc.replace(/^\/+/, ""),
    });
    const frame = hubFrame(page);
    await waitForFrameRoot(frame);
    await expectReaderHeading(frame, /Getting Started/i);
    return frame;
  }

  async function expectRepositoryImage(frame: ReturnType<typeof hubFrame>) {
    const image = frame.locator(".emr-repo-image").first();
    await expect(image).toBeVisible({ timeout: 30_000 });
    await expect(image).toHaveAttribute("src", /^blob:/);
    await expect
      .poll(() =>
        image.evaluate((element: HTMLImageElement) => element.naturalWidth),
      )
      .toBeGreaterThan(0);
  }

  test("a repository-relative image renders in the Documents hub", async ({
    page,
  }) => {
    const frame = await openLinkIndexDoc(page);
    await expectRepositoryImage(frame);
  });

  test("a relative Markdown link opens the target document in place", async ({
    page,
  }) => {
    const frame = await openLinkIndexDoc(page);

    // Click the relative link to `guides/install.md`. The reader must resolve it
    // and swap the document IN PLACE — the whole ArticleView → handleDocLink →
    // routeDocLink → select → reader chain, in the real hosted iframe. The
    // cross-origin iframe can swallow the first click, so retry until the
    // heading flips to the target doc.
    const link = frame
      .locator(".markdown-body a")
      .filter({ hasText: "installation guide" })
      .first();
    await link.waitFor({ state: "visible", timeout: 45_000 });

    await expect
      .poll(
        async () => {
          await link.click().catch(() => {});
          return (
            await frame
              .locator(".markdown-body h1")
              .first()
              .innerText()
              .catch(() => "")
          ).trim();
        },
        {
          timeout: 30_000,
          message: "reader never navigated to the linked document",
        },
      )
      .toMatch(/^Installation$/i);

    // In-place navigation also mirrors the new document onto the host URL
    // (`?path=`) via the navigation service — proving the host round-trip, not
    // just a client-side state swap.
    await expect
      .poll(() => new URL(page.url()).searchParams.get("path") ?? "", {
        timeout: 15_000,
        message: "host ?path= was not updated to the linked document",
      })
      .toMatch(/guides\/install\.md$/i);
  });

  test("a non-Markdown link opens ADO's file view in a new tab", async ({
    page,
    context,
  }) => {
    const frame = await openLinkIndexDoc(page);

    // The link to `../assets/architecture.svg` is a non-Markdown file: the
    // router hands it to ADO's native Files view via openNewWindow — a real new
    // browser tab. Capture that popup and assert it points at the file's
    // Repos/Files URL (proving buildReposFileUrl + openNewWindow end to end in
    // the real host).
    const link = frame
      .locator(".markdown-body a")
      .filter({ hasText: "architecture diagram" })
      .first();
    await link.waitFor({ state: "visible", timeout: 45_000 });

    const before = context.pages().length;
    // Retry the click until a new tab appears (the first cross-origin pointer
    // event can be swallowed, and openNewWindow resolves a service asynchronously
    // before opening the window). Only click while no new page exists so we
    // don't spawn duplicate tabs.
    await expect
      .poll(
        async () => {
          if (context.pages().length === before) {
            await link.click().catch(() => {});
          }
          return context.pages().length;
        },
        {
          timeout: 30_000,
          intervals: [750, 1000, 1500],
          message: "non-Markdown link never opened a new tab",
        },
      )
      .toBeGreaterThan(before);

    const popup = context.pages()[context.pages().length - 1]!;
    await popup.waitForLoadState("domcontentloaded").catch(() => {});
    const url = decodeURIComponent(popup.url());
    expect(url).toContain(`_git/${E2E.docLinksRepo}`);
    expect(url).toMatch(/assets\/architecture\.svg/i);
  });

  test("a Markdown link outside the PR opens the Documents hub in a new tab", async ({
    page,
    context,
  }) => {
    // Open the active "expand guides" PR (edits install.md + configure.md) in
    // our Markdown Review tab. Whichever guide the tab opens first links to
    // `../getting-started.md`, which is NOT part of the PR — so the router hands
    // it to the Documents hub in a new tab (buildHubDocUrl + openNewWindow),
    // the one ADO-interaction path the hub surface never exercises.
    const prId = await discoverPullRequestId(
      page,
      E2E.docLinksRepo,
      E2E.docLinksPrTitle,
      "active",
    );
    await gotoPrTab(page, E2E.docLinksRepo, prId);

    const frame = prTabFrame(page);
    await waitForFrameRoot(frame);
    await frame.locator(".markdown-body").first().waitFor({ timeout: 45_000 });

    const link = frame
      .locator(".markdown-body a")
      .filter({ hasText: /getting started/i })
      .first();
    await link.waitFor({ state: "visible", timeout: 45_000 });

    const before = context.pages().length;
    await expect
      .poll(
        async () => {
          if (context.pages().length === before) {
            await link.click().catch(() => {});
          }
          return context.pages().length;
        },
        {
          timeout: 30_000,
          intervals: [750, 1000, 1500],
          message: "out-of-PR link never opened a new tab",
        },
      )
      .toBeGreaterThan(before);

    const popup = context.pages()[context.pages().length - 1]!;
    await popup.waitForLoadState("domcontentloaded").catch(() => {});
    const url = decodeURIComponent(popup.url());
    expect(url).toContain("documents-hub");
    expect(url).toMatch(/getting-started\.md/i);
  });

  test("a nested repository-relative image renders in the PR tab", async ({
    page,
  }) => {
    const prId = await discoverPullRequestId(
      page,
      E2E.docLinksRepo,
      E2E.docLinksPrTitle,
      "active",
    );
    await gotoPrTab(page, E2E.docLinksRepo, prId);

    const frame = prTabFrame(page);
    await waitForFrameRoot(frame);
    await frame.locator(".markdown-body").first().waitFor({ timeout: 45_000 });
    await frame
      .locator("button.emr-docnav-file-label")
      .filter({ hasText: "install.md" })
      .click();
    await expectReaderHeading(frame, /^Installation$/i);
    await expectRepositoryImage(frame);
  });

  test("a Git LFS image added in the PR renders in the PR tab", async ({
    page,
  }) => {
    const prId = await discoverPullRequestId(
      page,
      E2E.docLinksRepo,
      E2E.docLinksLfsPrTitle,
      "active",
    );
    await gotoPrTab(page, E2E.docLinksRepo, prId);

    const frame = prTabFrame(page);
    await waitForFrameRoot(frame);
    await expectReaderHeading(frame, /^Git LFS Image$/i);

    const image = frame.getByAltText("Review flow stored in Git LFS");
    await expect(image).toBeVisible({ timeout: 30_000 });
    await expect(image).toHaveAttribute("src", /^blob:/);
    await expect
      .poll(() =>
        image.evaluate((element: HTMLImageElement) => ({
          width: element.naturalWidth,
          height: element.naturalHeight,
        })),
      )
      .toEqual({ width: 640, height: 240 });
  });
});
