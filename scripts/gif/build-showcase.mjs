/*
 * Build the "guided tour" showcase asset (GIF + MP4) for the extension.
 *
 * Pipeline (all local, deterministic, reproducible):
 *   1. Serve the *built* Storybook (storybook-static) on a private port.
 *   2. Navigate Playwright straight to the real PR-tab story, then inject —
 *      into the SAME document (no iframe, so the dimming overlay can darken
 *      everything uniformly) — an Azure DevOps PR chrome (scripts/gif/
 *      ado-chrome.mjs) above it and the annotation overlay (overlay.js) on top.
 *   3. Act out the headline flow for real (select a phrase -> selection bubble
 *      -> compose -> submit -> the note anchors as a PR comment), then spotlight
 *      the diff highlighting and the outline, one screenshot per frame.
 *   4. Encode with ffmpeg:
 *        static/showcase.gif  (native capture size) — packaged Marketplace + README hero
 *        assets/showcase.mp4                 — hackathon "video required" slot
 *
 * Run:  npm run gif:showcase
 * This is a build-time asset generator; nothing here ships in the extension.
 */
import { chromium } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { get as httpGet } from "node:http";
import { existsSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { adoChromeMarkup } from "./ado-chrome.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const OVERLAY = resolve(__dirname, "overlay.js");
const FRAMES_DIR = resolve(ROOT, "build", "showcase-frames");
const OUT_DIR = resolve(ROOT, "assets");
const STATIC_DIR = resolve(ROOT, "static");
const PORT = Number(process.env.EMR_SHOWCASE_PORT ?? 6123);
const BASE = `http://localhost:${PORT}`;

const FPS = 15;
const VW = 1600;
const ADO_RAIL_W = 60;
const SHOWCASE_GUTTER = 12;
const CHROME_H = 190;
const STORY_H = 860;
const VH = CHROME_H + STORY_H; // 1050

const STORY_URL = "/iframe.html?id=visual-prtab--default&viewMode=story";
const PHRASE = "resolved configuration";
const COMMENT = "Can we document how this gets resolved?";

const FFMPEG =
  process.env.FFMPEG_PATH ||
  (existsSync(
    resolve(
      process.env.LOCALAPPDATA ?? "",
      "Microsoft",
      "WinGet",
      "Links",
      "ffmpeg.exe",
    ),
  )
    ? resolve(
        process.env.LOCALAPPDATA ?? "",
        "Microsoft",
        "WinGet",
        "Links",
        "ffmpeg.exe",
      )
    : "ffmpeg");

/* ---------------------------------------------------------------- easing -- */
const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
const easeInOut = (t) =>
  (t = clamp01(t)) < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
function envelope(local, dur, inT, outT) {
  const up = inT > 0 ? easeInOut(local / inT) : 1;
  const down = outT > 0 ? easeInOut((dur - local) / outT) : 1;
  return clamp01(Math.min(up, down));
}
function badgePos(rect, side) {
  if (side === "right") return { x: rect.x + rect.w - 4, y: rect.y - 48 };
  return { x: rect.x, y: Math.max(CHROME_H + 8, rect.y - 48) };
}

/* -------------------------------------------------------------- plumbing -- */
function waitForServer(url, timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((res, rej) => {
    const tick = () => {
      const req = httpGet(url, (r) => {
        r.resume();
        res();
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) rej(new Error("server timeout"));
        else setTimeout(tick, 300);
      });
    };
    tick();
  });
}
function fresh(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

let frameCounter = 0;
function nextFramePath() {
  return resolve(
    FRAMES_DIR,
    `frame-${String(frameCounter++).padStart(4, "0")}.png`,
  );
}

async function renderOverlay(page, state) {
  await page.evaluate((s) => window.__tour.render(s), state);
}

async function captureRange(page, durationS, stateFor, beforeShot) {
  const n = Math.max(1, Math.round(durationS * FPS));
  for (let i = 0; i < n; i++) {
    const local = i / FPS;
    if (beforeShot) await beforeShot(local, i, n);
    await renderOverlay(page, stateFor(local, i, n));
    await page.screenshot({ path: nextFramePath(), animations: "disabled" });
  }
}

async function measure(page, selector, opts = {}) {
  const r = await page.evaluate(
    ([sel, o]) => window.__tour.measure(sel, o),
    [selector, opts],
  );
  return r ? { ...r, radius: opts.radius ?? 12 } : null;
}

/* ------------------------------------------------------------- page acts -- */
async function selectPhrase(page, phrase) {
  await page.evaluate((p) => {
    const root = document.querySelector(".emr-rendered");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const idx = node.data.indexOf(p);
      if (idx >= 0) {
        const r = document.createRange();
        r.setStart(node, idx);
        r.setEnd(node, idx + p.length);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        node.parentElement.dispatchEvent(
          new MouseEvent("mouseup", { bubbles: true }),
        );
        return;
      }
    }
  }, phrase);
  await page.waitForSelector(".emr-selection-bubble", { timeout: 8000 });
}
async function clickAddComment(page) {
  await page.evaluate(() => {
    const b = document.querySelector(".emr-selection-bubble button");
    if (b) b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await page.waitForSelector(".emr-balloon.is-draft textarea.emr-textarea", {
    timeout: 8000,
  });
}
async function setComposerValue(page, text) {
  await page.evaluate((t) => {
    const ta = document.querySelector(
      ".emr-balloon.is-draft textarea.emr-textarea",
    );
    if (!ta) return;
    const set = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    ).set;
    set.call(ta, t);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
}
async function submitComment(page) {
  await page.evaluate(() => {
    const btns = Array.from(
      document.querySelectorAll(".emr-composer-actions button"),
    );
    const b = btns.find((x) => /comment/i.test(x.textContent || ""));
    if (b) b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await page.waitForTimeout(400);
}

/* ------------------------------------------------------------- timeline -- */
async function capture(page) {
  const rail = await measure(page, ".emr-rail-col", { pad: 8 });
  const diffs = await measure(page, ".emr-diff-block", {
    pad: 12,
    maxHeight: 470,
  });
  const nav = await measure(page, ".emr-docnav", { pad: 8 });
  const tab = await measure(page, "#emr-ado-chrome .ado-tab.active", {
    pad: 6,
    radius: 8,
  });
  const PROG = 3;
  const brandOn = { brandAppear: 1 };

  // --- Intro (2.8s): dim the whole ADO window, fade the single title in. ---
  await captureRange(page, 2.8, (t) => ({
    dim: easeInOut(clamp01((t - 0.3) / 1.1)) * 0.72,
    spot: null,
    brandAppear: 0,
    card: {
      title: "Easy Markdown Review",
      sub: "Review Markdown like a Word doc \u2014 inside your pull request.",
      appear: envelope(t, 2.8, 0.6, 0.5),
    },
  }));

  // --- Establish (2.6s): spotlight the Markdown Review tab in the PR chrome
  //     so viewers see WHERE the experience lives; wordmark fades in now. ----
  await captureRange(page, 2.6, (t) => ({
    // Come out of the intro's full dim into a tab-focused spotlight: the tab
    // stays lit while the rest of the window is held back, so the eye lands
    // on it before the tour begins.
    dim: 0.72 - easeInOut(clamp01(t / 0.6)) * 0.14,
    spot: tab,
    ringOpacity: easeInOut(clamp01(t / 0.5)),
    brandAppear: easeInOut(clamp01(t / 0.6)),
    caption: {
      title: "A Review tab on every pull request",
      sub: "Your Markdown, rendered \u2014 not a raw diff.",
      appear: envelope(t, 2.6, 0.4, 0.35),
    },
  }));

  // --- Flow 1: select a phrase -> selection bubble. ------------------------
  await selectPhrase(page, PHRASE);
  // Badge #1 is shown ONLY once the focus box lands on the rail (Flow 4), so
  // the feature name appears together with the thing it points at.
  const badge1 = (appear = 1) => {
    const p = badgePos(rail, "left");
    return {
      num: 1,
      label: "Word-style anchored comments",
      x: p.x,
      y: p.y,
      appear,
    };
  };
  await captureRange(page, 3.0, (t) => ({
    dim: 0,
    spot: null,
    ...brandOn,
    caption: {
      title: "Highlight any sentence",
      sub: "Right on the rendered page.",
      appear: envelope(t, 3.0, 0.4, 0.3),
    },
  }));

  // --- Flow 2: open the composer. ------------------------------------------
  await clickAddComment(page);
  await captureRange(page, 2.0, (t) => ({
    dim: 0,
    spot: null,
    ...brandOn,
    caption: {
      title: "Add a comment",
      sub: "Just like you would in Word.",
      appear: envelope(t, 2.0, 0.35, 0.3),
    },
  }));

  // --- Flow 3: type the comment (animated). --------------------------------
  await captureRange(
    page,
    3.2,
    () => ({
      dim: 0,
      spot: null,
      ...brandOn,
      caption: {
        title: "Write your note",
        sub: "Mentions, code and lists all work.",
        appear: 1,
      },
    }),
    async (local) => {
      const typed = clamp01((local - 0.2) / 2.2);
      const len = Math.round(typed * COMMENT.length);
      await setComposerValue(page, COMMENT.slice(0, len));
    },
  );

  // --- Flow 4: submit -> the note anchors; spotlight the rail + badge #1. ---
  await setComposerValue(page, COMMENT);
  await submitComment(page);
  await captureRange(page, 3.6, (t) => ({
    dim: 0.6 * easeInOut(clamp01(t / 0.5)),
    spot: rail,
    ringOpacity: easeInOut(clamp01(t / 0.5)),
    ...brandOn,
    badge: badge1(envelope(t, 3.6, 0.5, 0.35)),
    caption: {
      title: "It lands as a real PR comment",
      sub: "Anchored to the words you picked.",
      appear: envelope(t, 3.6, 0.4, 0.35),
    },
    progress: { index: 0, total: PROG, appear: envelope(t, 3.6, 0.4, 0.3) },
  }));

  // --- Feature 2: diffs on the rendered Markdown. --------------------------
  await captureRange(page, 4.4, (t) => {
    const p = badgePos(diffs, "top");
    return {
      dim: 0.66,
      spot: diffs,
      ringOpacity: 1,
      ...brandOn,
      badge: {
        num: 2,
        label: "See what changed",
        x: p.x,
        y: p.y,
        appear: envelope(t, 4.4, 0.45, 0.35),
      },
      caption: {
        title: "See every change in place",
        sub: "Added, edited and removed \u2014 right on the page.",
        appear: envelope(t, 4.4, 0.45, 0.35),
      },
      progress: { index: 1, total: PROG, appear: 1 },
    };
  });

  // --- Feature 3: outline & navigation. ------------------------------------
  await captureRange(page, 4.2, (t) => {
    const p = badgePos(nav, "right");
    return {
      dim: 0.66,
      spot: nav,
      ringOpacity: 1,
      ...brandOn,
      badge: {
        num: 3,
        label: "Outline & navigation",
        x: p.x,
        y: p.y,
        appear: envelope(t, 4.2, 0.45, 0.35),
      },
      caption: {
        title: "Jump anywhere fast",
        sub: "Every file and heading, one click away.",
        appear: envelope(t, 4.2, 0.45, 0.35),
      },
      progress: { index: 2, total: PROG, appear: 1 },
    };
  });

  // --- Outro (2.8s). -------------------------------------------------------
  await captureRange(page, 2.8, (t) => ({
    dim: 0.8 * easeInOut(clamp01(t / 0.5)),
    spot: null,
    brandAppear: 0,
    card: {
      title: "Easy Markdown Review",
      sub: "A Word-doc review experience, right in Azure DevOps.",
      appear: envelope(t, 2.8, 0.5, 0),
    },
  }));
}

/* --------------------------------------------------------------- encode -- */
function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.status !== 0) {
    process.stderr.write(r.stderr?.toString() ?? "");
    throw new Error(`${cmd} exited ${r.status}`);
  }
}
const inArgs = () => [
  "-framerate",
  String(FPS),
  "-i",
  resolve(FRAMES_DIR, "frame-%04d.png"),
];

function encodeGifAttempt(gifFps, gifW) {
  const palette = resolve(FRAMES_DIR, "palette.png");
  const gif = resolve(STATIC_DIR, "showcase.gif");
  const vf = `fps=${gifFps},scale=${gifW}:-1:flags=lanczos`;
  run(FFMPEG, [
    "-y",
    ...inArgs(),
    "-vf",
    `${vf},palettegen=stats_mode=diff`,
    palette,
  ]);
  run(FFMPEG, [
    "-y",
    ...inArgs(),
    "-i",
    palette,
    "-lavfi",
    `${vf} [x];[x][1:v] paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`,
    gif,
  ]);
  return statSync(gif).size;
}

function encode() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(STATIC_DIR, { recursive: true });
  console.log(`[showcase] gif @ ${FPS}fps ${VW}px …`);
  const gifSize = encodeGifAttempt(FPS, VW);
  console.log(`           -> ${(gifSize / 1048576).toFixed(2)} MB`);

  console.log("[showcase] mp4 …");
  const mp4 = resolve(OUT_DIR, "showcase.mp4");
  run(FFMPEG, [
    "-y",
    ...inArgs(),
    "-vf",
    `scale=${VW}:-2:flags=lanczos,fps=30,format=yuv420p`,
    "-c:v",
    "libx264",
    "-crf",
    "20",
    "-preset",
    "slow",
    "-movflags",
    "+faststart",
    mp4,
  ]);

  console.log(
    `[showcase] static/showcase.gif  ${(gifSize / 1048576).toFixed(2)} MB`,
  );
  console.log(
    `[showcase] assets/showcase.mp4  ${(statSync(mp4).size / 1048576).toFixed(2)} MB`,
  );
}

/* ----------------------------------------------------------------- main -- */
async function main() {
  if (process.argv.includes("--encode-only")) return encode();
  fresh(FRAMES_DIR);

  const server = spawn(
    process.execPath,
    [resolve(ROOT, "scripts", "serve-storybook.mjs")],
    {
      cwd: ROOT,
      env: { ...process.env, EMR_VISUAL_PORT: String(PORT) },
      stdio: "inherit",
    },
  );
  await waitForServer(`${BASE}/index.json`);

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: VW, height: VH },
    deviceScaleFactor: 1,
  });
  try {
    await page.goto(`${BASE}${STORY_URL}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".emr-docnav", { timeout: 20000 });
    await page.waitForSelector(".emr-diff-block", { timeout: 20000 });
    await page.waitForSelector(".emr-rail-col", { timeout: 20000 });

    // Frame the story inside the ADO PR chrome, in the SAME document.
    const { css, html } = adoChromeMarkup({
      width: VW,
      chromeHeight: CHROME_H,
    });
    await page.addStyleTag({
      content:
        css +
        `\nhtml,body{margin:0!important;padding:0!important;overflow:hidden!important;background:linear-gradient(to right,#f3f2f1 0 ${ADO_RAIL_W}px,#f8f8f8 ${ADO_RAIL_W}px ${ADO_RAIL_W + SHOWCASE_GUTTER}px,#fff ${ADO_RAIL_W + SHOWCASE_GUTTER}px calc(100% - ${SHOWCASE_GUTTER}px),#f8f8f8 calc(100% - ${SHOWCASE_GUTTER}px) 100%)!important;}` +
        `\n#storybook-root{position:absolute!important;top:${CHROME_H}px!important;left:${ADO_RAIL_W + SHOWCASE_GUTTER}px!important;width:${VW - ADO_RAIL_W - SHOWCASE_GUTTER * 2}px!important;height:${STORY_H}px!important;overflow:hidden!important;}` +
        `\n#storybook-root>*{height:${STORY_H}px!important;}`,
    });
    await page.evaluate((h) => {
      const d = document.createElement("div");
      d.id = "emr-ado-chrome";
      d.innerHTML = h;
      document.body.appendChild(d);
    }, html);

    await page.waitForTimeout(500);
    await page.addScriptTag({ path: OVERLAY });
    await page.evaluate(() => window.__tour.setup());
    await capture(page);
  } finally {
    await browser.close();
    server.kill();
  }

  const count = readdirSync(FRAMES_DIR).filter((f) =>
    f.endsWith(".png"),
  ).length;
  console.log(`[showcase] captured ${count} frames @ ${FPS}fps`);
  encode();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
