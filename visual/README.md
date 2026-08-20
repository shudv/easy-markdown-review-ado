# Curated visual-regression suite

A small, high-signal set of **screenshot tests** that guard against visual
regressions — the visual analogue of the e2e inner loop. It screenshots
deterministic **Storybook** stories and compares them against committed
baselines with a tight tolerance.

- Config: [`playwright.visual.config.ts`](../playwright.visual.config.ts)
- Spec: [`curated.visual.spec.ts`](./curated.visual.spec.ts)
- Baselines: [`__screenshots__/`](./__screenshots__) (committed, **one set** — rendered in the pinned Playwright container)

## What it captures

A curated set of deterministic shots fed fake fixtures (no ADO, no network):

| Story / variant                   | Covers                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `Visual/PrTab` — Default/Dark     | Reader + **diff highlighting** (added/edited/removed) + rail, light & dark            |
| `Visual/DocumentsHub`             | Repo/file navigator + reader + comment rail                                           |
| `Visual/ArticleDiff` — Light/Dark | The diff-highlighting layer in isolation (add wash, inline word-diff, deleted-marker) |
| `Visual/BalloonGallery`           | Comment-thread balloon states (active / resolved / orphaned)                          |

Together they exercise Markdown rendering, the diff wash layer (both themes),
comment balloons, and the rail chrome. To add a shot, author a deterministic
`*.visual.stories.tsx` (no time, no animation, no Mermaid) and add a
`{ title, name, settledSelector }` entry to the `SHOTS` array in the spec.

## Running locally

Rendering happens in the pinned Playwright **container** (see below), so the
local commands wrap Docker — you need Docker running:

```bash
npm run test:visual:docker   # compare against the committed baselines (in Docker)
npm run test:visual:update   # regenerate the baselines (in Docker)
npm run test:visual:report   # open the HTML diff report after a failure
```

Both wrap [`scripts/visual-docker.mjs`](../scripts/visual-docker.mjs): it builds
the static Storybook on the host (the bundle is platform-independent), then runs
Playwright **inside** `mcr.microsoft.com/playwright:v1.61.1-jammy` so the render
matches CI exactly. (`npm run test:visual` is the raw, in-container compare that
CI itself invokes — running it bare on a Windows/macOS host will mismatch.)

> **Why `--update-snapshots=all`:** Playwright's default update mode is
> `changed`, which only rewrites a baseline when the new render diffs **beyond**
> `maxDiffPixelRatio`. A _sub-threshold_ change (e.g. a small icon on a large
> composite shot) then neither fails the check **nor** gets rewritten — the
> baseline silently drifts stale. The wrapper passes `--update-snapshots=all` so
> a regenerate is always truthful. (The complementary guard against the check
> _missing_ such a change is a **focused cropped shot** — see below.)

## Focused (cropped) shots

Whole-page composite shots (1600×900 ≈ 1.44M px) can't catch a small change:
`maxDiffPixelRatio: 0.002` is a ~2,880 px budget, but a 15 px icon or a per-file
tree glyph is only a few hundred px, so it slips under the threshold. For
controls whose _correctness is a small glyph_ (the toggle icons, the resolved
badge, the Documents-hub file-tree's absence of change indicators), add a
**focused shot** with a `clip` selector so that element fills the frame and the
same tolerance now catches the change. See the `clip` entries in the `SHOTS`
array in [`curated.visual.spec.ts`](./curated.visual.spec.ts).

## Why one baseline set (in a container)?

Playwright pins the Chromium **build**, but Chromium does **not** rasterize
pixel-identically across operating systems: text anti-aliasing is done by the OS
font stack (DirectWrite on Windows, FreeType on Linux, CoreText on macOS), and
even the Linux CI pool's fonts differ from a stock image. Rather than juggle a
baseline per platform (which can't be regenerated off the machine that renders
it), the suite pins **one** rendering environment — the
`mcr.microsoft.com/playwright:v1.61.1-jammy` container — and uses it **both** in
CI and locally. Renders are byte-identical, so a **single** committed set
(`<name>-chromium.png`) is authoritative everywhere.

## Regenerating baselines

Run `npm run test:visual:update` (needs Docker). It builds the static Storybook
on the host, then (re)writes the baselines **inside** the pinned container so
they match CI. Commit the regenerated `*-chromium.png` files with your change.

> **Bumping Playwright:** update the tag in **two** places together — the
> `@playwright/test` dependency and `IMAGE` in
> [`scripts/visual-docker.mjs`](../scripts/visual-docker.mjs) — then regenerate
> the baselines. (The tag also appears in a comment in
> [`.azure-pipelines/pr-validation.yml`](../.azure-pipelines/pr-validation.yml);
> refresh it there for accuracy — CI reads the image from the wrapper, not a
> `container:` resource.)

## When a visual test fails

1. Open the report: `npm run test:visual:report` (locally) or download the
   `visual-report` pipeline artifact (CI).
2. If the change is an **intended** visual update, regenerate the baselines with
   `npm run test:visual:update` (Docker) and commit the `*-chromium.png` files.
3. If it's a **regression**, fix the CSS/layout — do not update the baseline.
