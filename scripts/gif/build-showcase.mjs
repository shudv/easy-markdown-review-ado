/*
 * Build the narrated showcase video (+ the silent Marketplace GIF).
 *
 * Pipeline (all local, deterministic, reproducible):
 *   1. Synthesize the narration (scripts/gif/narration.mjs) with neural TTS and
 *      measure every clip. Scene lengths are derived from those measurements,
 *      so the picture can never drift out of sync with the voice.
 *   2. Serve the *built* Storybook (storybook-static) on a private port.
 *   3. Navigate Playwright straight to the real PR-tab story, then inject —
 *      into the SAME document (no iframe, so the dimming overlay can darken
 *      everything uniformly) — an Azure DevOps PR chrome (scripts/gif/
 *      ado-chrome.mjs) above it and the annotation overlay (overlay.js) on top.
 *   4. Act out the headline flow for real (select a phrase -> selection bubble
 *      -> compose -> submit -> the note anchors as a PR comment), then spotlight
 *      the diff highlighting and the outline, one screenshot per frame.
 *   5. Encode with ffmpeg:
 *        assets/showcase.mp4  1080p, narrated — the showcase video
 *        assets/showcase.vtt  captions for the same timeline
 *        static/showcase.gif  silent, product scenes only — Marketplace/README hero
 *
 * Run:  npm run video:showcase          (add --no-audio to skip TTS)
 * This is a build-time asset generator; nothing here ships in the extension.
 */
import { chromium } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { get as httpGet } from "node:http";
import {
  existsSync,
  mkdirSync,
  rmSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { adoChromeMarkup } from "./ado-chrome.mjs";
import { adoFilesMarkup } from "./ado-files.mjs";
import { SCRIPT, VOICE, VOICE_SAMPLE, VOICE_SHORTLIST } from "./narration.mjs";
import {
  buildClips,
  buildTrack,
  buildVtt,
  checkTtsAvailable,
  previewVoices,
} from "./tts.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const OVERLAY = resolve(__dirname, "overlay.js");
const FRAMES_DIR = resolve(ROOT, "build", "showcase-frames");
const AUDIO_DIR = resolve(ROOT, "build", "showcase-audio");
const CLIP_CACHE = resolve(AUDIO_DIR, "clips");
const TAKE_CACHE = resolve(AUDIO_DIR, "takes");
// Drop your own recordings here, one per narration id, to replace the voice.
const TAKES_DIR = resolve(ROOT, "assets", "narration");
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

// 16:9 delivery so the file plays full-frame on every player/upload target.
const OUT_W = 1920;
const OUT_H = 1080;
const FIT_W = 1646; // 1600 x (1080/1050), rounded to an even width
const MATTE = "0x0a0c10";
const GIF_MAX_BYTES = 5 * 1024 * 1024;

const STORY_URL = "/iframe.html?id=visual-prtab--showcase&viewMode=story";
const PHRASE = "resolved configuration";
const COMMENT = "Can we document how this gets resolved?";
const STORY_LEFT = ADO_RAIL_W + SHOWCASE_GUTTER;
const STORY_W = VW - ADO_RAIL_W - SHOWCASE_GUTTER * 2;

const wingetBin = (exe) =>
  resolve(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Links", exe);
const FFMPEG =
  process.env.FFMPEG_PATH ||
  (existsSync(wingetBin("ffmpeg.exe")) ? wingetBin("ffmpeg.exe") : "ffmpeg");
const FFPROBE =
  process.env.FFPROBE_PATH ||
  (existsSync(wingetBin("ffprobe.exe")) ? wingetBin("ffprobe.exe") : "ffprobe");

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

/* --------------------------------------------------------------- timing -- */
/*
 * The single source of truth for sync: every scene is exactly
 * round((lead + spoken + tail) * FPS) frames long, and the voice track is laid
 * out against those same frame counts. Without narration (--no-audio) the
 * spoken length falls back to a reading-speed estimate so the picture still
 * paces the same.
 */
const WORDS_PER_SECOND = 2.6;

function buildPlan(clips) {
  const scenes = [];
  let frame = 0;
  for (const beat of SCRIPT) {
    const clip = clips?.get(beat.id);
    const clipDur =
      clip?.dur ?? beat.say.trim().split(/\s+/).length / WORDS_PER_SECOND;
    const frames = Math.round((beat.lead + clipDur + beat.tail) * FPS);
    scenes.push({
      id: beat.id,
      say: beat.say,
      lead: beat.lead,
      clip: clip?.file ?? null,
      clipDur,
      frames,
      startFrame: frame,
      dur: frames / FPS,
    });
    frame += frames;
  }
  const byId = new Map(scenes.map((s) => [s.id, s]));
  return { scenes, byId, totalFrames: frame };
}

/* -------------------------------------------------------------- plumbing -- */
function waitForServer(url, timeoutMs = 180000) {
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
// Swap the PR chrome between the "before" (Files) and "after" (Markdown
// Review) tabs, showing or hiding the injected Files panel with it.
async function showTab(page, tab, filesMode = null) {
  await page.evaluate(
    ([which, mode]) => {
      for (const el of document.querySelectorAll("#emr-ado-chrome .ado-tab")) {
        el.classList.toggle("active", el.dataset.tab === which);
      }
      const files = document.getElementById("emr-ado-files");
      if (mode) files.dataset.mode = mode;
      else delete files.dataset.mode;
    },
    [tab, filesMode],
  );
}

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

async function revealLinkChange(page) {
  const selector =
    '.emr-diff-metadata-trigger[aria-label="Show link target change"]';
  await page.click(selector);
  await page.waitForFunction(
    (triggerSelector) =>
      document.querySelector(triggerSelector)?.getAttribute("aria-expanded") ===
      "true",
    selector,
  );
}

async function hideLinkChange(page) {
  const selector =
    '.emr-diff-metadata-trigger[aria-label="Show link target change"]';
  await page.click(selector);
  await page.waitForFunction(
    (triggerSelector) =>
      document.querySelector(triggerSelector)?.getAttribute("aria-expanded") ===
      "false",
    selector,
  );
}

async function strengthenAddedRow(page) {
  // Keep the product green legible after the spotlight and GIF quantization.
  await page.locator("tr.emr-diff-block--added").evaluate((row) => {
    for (const cell of row.querySelectorAll("th, td")) {
      cell.style.background = "#2da44e";
    }
  });
}

/* ------------------------------------------------------------- timeline -- */
async function capture(page, plan) {
  // The Files panel has to be on screen to be measurable, and the opening beat
  // starts there anyway.
  await showTab(page, "files", "diff");

  const rail = await measure(page, ".emr-rail-col", { pad: 8 });
  const diffs = await measure(
    page,
    ".emr-diff-block, .emr-diff-deleted-table-row",
    {
      pad: 12,
      maxHeight: 470,
    },
  );
  const nav = await measure(page, ".emr-docnav", { pad: 8 });
  const reviewTab = await measure(
    page,
    '#emr-ado-chrome .ado-tab[data-tab="review"]',
    { pad: 6, radius: 8 },
  );
  const filesTab = await measure(
    page,
    '#emr-ado-chrome .ado-tab[data-tab="files"]',
    { pad: 6, radius: 8 },
  );
  const previewBtn = await measure(page, "#emr-ado-files .fx-opt-preview", {
    pad: 0,
  });
  const diffBtn = await measure(page, "#emr-ado-files .fx-opt-diff", {
    pad: 0,
  });
  // Just the two link lines — `max: 2` stops the union swallowing the deleted
  // table row further down the file.
  const changedLine = await measure(
    page,
    "#emr-ado-files .fx-del, #emr-ado-files .fx-add",
    { pad: 8, max: 2 },
  );
  const centerOf = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const PROG = 3;
  const brandOn = { brandAppear: 1 };

  // Scene helper: `d` is the scene length, `t` the seconds elapsed inside it.
  // Captions/cards fade with the voice rather than on fixed timings.
  const scene = (id) => plan.byId.get(id);
  const run = (id, stateFor, beforeShot) =>
    captureRange(page, scene(id).dur, stateFor, beforeShot);
  const fade = (id, inT = 0.45, outT = 0.4) => {
    const d = scene(id).dur;
    return (t) => envelope(t, d, inT, outT);
  };
  // A click: the ring runs over ~0.4s starting at `at`.
  const clickAt = (t, at) => clamp01((t - at) / 0.4);

  /* -- Act 1: the problem, acted out in the Files tab --------------------- */

  const a1 = fade("problem-a", 0.7, 0.5);
  await run("problem-a", (t) => ({
    dim: easeInOut(clamp01((t - 0.2) / 1.0)) * 0.85,
    spot: null,
    brandAppear: 0,
    card: {
      kicker: "Where we are today",
      title: "Markdown is how we write everything now.",
      sub: "Design docs. Runbooks. Agent instructions.",
      appear: a1(t),
    },
  }));

  // Pull the dim down so the markup is actually readable, put the focus on the
  // one-character link change, then move the cursor up to the Preview toggle.
  const pb = scene("problem-b");
  const a2 = fade("problem-b", 0.45, 0.35);
  const pbClick = pb.dur - 0.55;
  await run("problem-b", (t) => {
    const settle = easeInOut(clamp01((t - 0.15) / 0.8));
    const travel = easeInOut(clamp01((t - (pbClick - 0.9)) / 0.75));
    const from = centerOf(changedLine);
    const to = centerOf(previewBtn);
    return {
      dim: 0.85 - settle * 0.55,
      spot: t < 0.9 ? filesTab : changedLine,
      ringOpacity: easeInOut(clamp01(t / 0.4)),
      brandAppear: 0,
      pointer: {
        x: from.x + (to.x - from.x) * travel,
        y: from.y + (to.y - from.y) * travel,
        appear: easeInOut(clamp01((t - 1.2) / 0.5)),
        click: clickAt(t, pbClick),
      },
      caption: {
        title: "Today you review the markup",
        sub: "The only prose change here is one character inside a link.",
        appear: a2(t),
      },
    };
  });

  // Preview shows the page but not the change — and there is nothing to
  // comment on — so the cursor goes straight back to Diff.
  await showTab(page, "files", "preview");
  const pc = scene("problem-c");
  const a3 = fade("problem-c", 0.45, 0.4);
  const pcBack = pc.dur - 1.15;
  let flippedBack = false;
  await run(
    "problem-c",
    (t) => {
      const travel = easeInOut(clamp01((t - (pcBack - 0.8)) / 0.7));
      const from = centerOf(previewBtn);
      const to = centerOf(diffBtn);
      return {
        dim: 0.3,
        spot: null,
        brandAppear: 0,
        pointer: {
          x: from.x + (to.x - from.x) * travel,
          y: from.y + (to.y - from.y) * travel,
          appear: 1,
          click: clickAt(t, pcBack),
        },
        caption: {
          title: "Preview shows the page, not the change",
          sub: "And there's nothing here to comment on.",
          appear: a3(t),
        },
      };
    },
    async (local) => {
      // Flip back to the diff as the second click lands.
      if (!flippedBack && local >= pcBack + 0.12) {
        flippedBack = true;
        await showTab(page, "files", "diff");
      }
    },
  );

  /* -- Act 2: the product ------------------------------------------------- */

  await showTab(page, "review");
  const a4 = fade("solution", 0.5, 0.45);
  await run("solution", (t) => ({
    dim: 0.82,
    spot: null,
    brandAppear: 0,
    card: {
      title: "Easy Markdown Review",
      sub: "Review Markdown like a document — inside your pull request.",
      appear: a4(t),
    },
  }));

  const a5 = fade("establish", 0.4, 0.35);
  await run("establish", (t) => ({
    dim: 0.72 - easeInOut(clamp01(t / 0.6)) * 0.14,
    spot: reviewTab,
    ringOpacity: easeInOut(clamp01(t / 0.5)),
    brandAppear: easeInOut(clamp01(t / 0.6)),
    caption: {
      title: "A review tab on every pull request",
      sub: "Your Markdown, rendered — not a raw diff.",
      appear: a5(t),
    },
  }));

  /* -- Act 3: the flow, performed for real -------------------------------- */

  await selectPhrase(page, PHRASE);
  const a6 = fade("select", 0.4, 0.3);
  await run("select", (t) => ({
    dim: 0,
    spot: null,
    ...brandOn,
    caption: {
      title: "Highlight any sentence",
      sub: "Right on the rendered page.",
      appear: a6(t),
    },
  }));

  await clickAddComment(page);
  const compose = scene("compose");
  const a7 = fade("compose", 0.35, 0.3);
  await run(
    "compose",
    (t) => ({
      dim: 0,
      spot: null,
      ...brandOn,
      caption: {
        title: "Comment like it's a Word doc",
        sub: "Mentions, code and lists all work.",
        appear: a7(t),
      },
    }),
    async (local) => {
      // Finish typing just before the line ends so the submit reads as a beat.
      const typed = clamp01(
        (local - compose.lead) / Math.max(0.6, compose.clipDur - 0.5),
      );
      await setComposerValue(
        page,
        COMMENT.slice(0, Math.round(typed * COMMENT.length)),
      );
    },
  );

  await setComposerValue(page, COMMENT);
  await submitComment(page);
  const submit = scene("submit");
  const a8 = fade("submit", 0.45, 0.35);
  await run("submit", (t) => ({
    dim: 0.6 * easeInOut(clamp01(t / 0.5)),
    spot: rail,
    ringOpacity: easeInOut(clamp01(t / 0.5)),
    ...brandOn,
    badge: {
      num: 1,
      label: "Word-style anchored comments",
      ...badgePos(rail, "left"),
      appear: envelope(t, submit.dur, 0.55, 0.35),
    },
    caption: {
      title: "It lands as a real PR comment",
      sub: "Anchored to the words you picked.",
      appear: a8(t),
    },
    progress: {
      index: 0,
      total: PROG,
      appear: envelope(t, submit.dur, 0.4, 0.3),
    },
  }));

  /* -- Act 4: the rest of the surface ------------------------------------- */

  await strengthenAddedRow(page);
  await revealLinkChange(page);
  const a9 = fade("diffs", 0.45, 0.35);
  await run("diffs", (t) => ({
    dim: 0.66,
    spot: diffs,
    ringOpacity: 1,
    ...brandOn,
    badge: {
      num: 2,
      label: "Semantic diffs",
      ...badgePos(diffs, "top"),
      appear: a9(t),
    },
    caption: {
      title: "See exactly what changed",
      sub: "Changed link. Added row. Deleted row.",
      appear: a9(t),
    },
    progress: { index: 1, total: PROG, appear: 1 },
  }));

  await hideLinkChange(page);
  const a10 = fade("nav", 0.45, 0.35);
  await run("nav", (t) => ({
    dim: 0.66,
    spot: nav,
    ringOpacity: 1,
    ...brandOn,
    badge: {
      num: 3,
      label: "Outline & navigation",
      ...badgePos(nav, "right"),
      appear: a10(t),
    },
    caption: {
      title: "Jump anywhere fast",
      sub: "Every file and heading, one click away.",
      appear: a10(t),
    },
    progress: { index: 2, total: PROG, appear: 1 },
  }));

  /* -- Act 5: why it matters, and where it already runs ------------------- */

  const a11 = fade("value", 0.55, 0.45);
  await run("value", (t) => ({
    dim: 0.66 + easeInOut(clamp01(t / 0.7)) * 0.18,
    spot: null,
    ...brandOn,
    card: {
      kicker: "Why it matters",
      title: "Reviewers stop skipping the docs.",
      sub: "Feedback gets specific, and it sticks to the words it was written about.",
      appear: a11(t),
    },
  }));

  const traction = scene("traction");
  const a12 = fade("traction", 0.5, 0.45);
  const TILES = [
    { value: "15", label: "Azure DevOps organizations" },
    { value: "100s", label: "developers using it every day" },
  ];
  await run("traction", (t) => ({
    dim: 0.88,
    spot: null,
    ...brandOn,
    card: {
      anchor: "high",
      kicker: "Not a prototype",
      title: "Shipped, and running at Microsoft today.",
      appear: a12(t),
    },
    stats: {
      items: TILES.map((item, i) => {
        // Stagger the tiles in after the headline has landed.
        const delay = traction.lead + 0.9 + i * 0.4;
        return {
          ...item,
          appear: envelope(t - delay, traction.dur - delay, 0.45, 0.45),
        };
      }),
    },
  }));

  const a13 = fade("outro", 0.6, 0.7);
  await run("outro", (t) => ({
    dim: 0.88 + easeInOut(clamp01(t / 0.8)) * 0.1,
    spot: null,
    brandAppear: 1 - easeInOut(clamp01(t / 0.5)),
    card: {
      title: "Easy Markdown Review",
      sub: "Review Markdown like a document. Inside Azure DevOps.",
      foot: "Azure DevOps Marketplace",
      appear: a13(t),
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
// `-t` is an *input* option here, so it clips the image sequence itself — that
// keeps the two-pass palette and the final render reading the same frames.
const inArgs = (startFrame = 0, seconds = null) => [
  "-framerate",
  String(FPS),
  "-start_number",
  String(startFrame),
  ...(seconds ? ["-t", seconds.toFixed(4)] : []),
  "-i",
  resolve(FRAMES_DIR, "frame-%04d.png"),
];

function encodeGifAttempt(range, gifFps, gifW) {
  const palette = resolve(FRAMES_DIR, "palette.png");
  const gif = resolve(STATIC_DIR, "showcase.gif");
  const src = inArgs(range.start, range.frames / FPS);
  const vf = `fps=${gifFps},scale=${gifW}:-1:flags=lanczos`;
  run(FFMPEG, [
    "-y",
    ...src,
    "-vf",
    `${vf},palettegen=stats_mode=diff`,
    palette,
  ]);
  run(FFMPEG, [
    "-y",
    ...src,
    "-i",
    palette,
    "-lavfi",
    `${vf} [x];[x][1:v] paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`,
    gif,
  ]);
  return statSync(gif).size;
}

// Marketplace/README hero: the product scenes only, silent, under the size cap.
function encodeGif(range) {
  mkdirSync(STATIC_DIR, { recursive: true });
  const ladder = [
    [FPS, VW],
    [13, 1360],
    [12, 1200],
    [10, 1040],
  ];
  let size = 0;
  for (const [gifFps, gifW] of ladder) {
    console.log(`[showcase] gif @ ${gifFps}fps ${gifW}px …`);
    size = encodeGifAttempt(range, gifFps, gifW);
    console.log(`           -> ${(size / 1048576).toFixed(2)} MB`);
    if (size <= GIF_MAX_BYTES) break;
  }
  return size;
}

function encodeMp4(totalFrames, audio) {
  mkdirSync(OUT_DIR, { recursive: true });
  const mp4 = resolve(OUT_DIR, "showcase.mp4");
  console.log(
    `[showcase] mp4 ${OUT_W}x${OUT_H}${audio ? " + narration" : ""} …`,
  );
  run(FFMPEG, [
    "-y",
    ...inArgs(0, totalFrames / FPS),
    ...(audio ? ["-i", audio] : []),
    ...(audio ? ["-map", "0:v:0", "-map", "1:a:0"] : ["-map", "0:v:0"]),
    "-vf",
    [
      `scale=${FIT_W}:${OUT_H}:flags=lanczos`,
      `pad=${OUT_W}:${OUT_H}:(ow-iw)/2:0:color=${MATTE}`,
      "fps=30",
      "format=yuv420p",
    ].join(","),
    "-c:v",
    "libx264",
    "-crf",
    "19",
    "-preset",
    "slow",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    ...(audio
      ? ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-shortest"]
      : ["-an"]),
    "-movflags",
    "+faststart",
    mp4,
  ]);
  return mp4;
}

/* ----------------------------------------------------------------- main -- */
function printScript() {
  console.log(
    `\nRecord one file per line into:\n  ${TAKES_DIR}\\<id>.wav  (wav/mp3/m4a/flac/ogg)\n` +
      `Leading and trailing silence is trimmed for you, so just read the line.\n` +
      `Anything you skip keeps the synthetic voice. Then run: npm run video:showcase\n`,
  );
  for (const beat of SCRIPT) {
    console.log(`\n[${beat.id}]\n  ${beat.say}`);
  }
  console.log("");
}

function previewTheVoices() {
  const outDir = resolve(AUDIO_DIR, "voice-preview");
  const takes = previewVoices(VOICE_SAMPLE, VOICE_SHORTLIST, {
    voice: VOICE,
    outDir,
    ffprobe: FFPROBE,
  });
  console.log(`\nSample: "${VOICE_SAMPLE}"\n`);
  for (const take of takes) {
    console.log(
      `  ${take.name.padEnd(34)} ${take.dur.toFixed(1)}s  ${take.note}`,
    );
  }
  console.log(
    `\nClips: ${outDir}\n` +
      `Pick one, then:  $env:EMR_VOICE = "<name>"; npm run video:showcase\n` +
      `Speed/pitch too: EMR_VOICE_RATE (e.g. "+8%"), EMR_VOICE_PITCH (e.g. "-4Hz")\n`,
  );
  spawnSync("explorer.exe", [outDir]);
}

async function main() {
  if (process.argv.includes("--print-script")) return printScript();
  if (process.argv.includes("--preview-voices")) return previewTheVoices();

  const withAudio = !process.argv.includes("--no-audio");
  // --my-voice refuses to fall back to TTS, so a missing take is an error
  // rather than a robot sentence you only notice on playback.
  const myVoiceOnly = process.argv.includes("--my-voice");
  if (withAudio && !myVoiceOnly && !checkTtsAvailable()) {
    throw new Error(
      "edge-tts is not installed. Run `python -m pip install edge-tts`, or pass --no-audio.",
    );
  }

  const clips = withAudio
    ? buildClips(SCRIPT, VOICE, {
        takesDir: TAKES_DIR,
        cacheDir: CLIP_CACHE,
        takeWorkDir: TAKE_CACHE,
        ffmpeg: FFMPEG,
        ffprobe: FFPROBE,
        allowSynthetic: !myVoiceOnly,
      })
    : null;
  const plan = buildPlan(clips);
  if (clips) {
    const mine = [...clips.values()].filter((c) => c.source === "you").length;
    console.log(
      `[narration] ${mine}/${clips.size} lines in your voice` +
        (mine === clips.size ? "" : ` (rest synthetic — see ${TAKES_DIR})`),
    );
  }
  console.log(
    `[showcase] ${plan.scenes.length} scenes, ${plan.totalFrames} frames (${(
      plan.totalFrames / FPS
    ).toFixed(1)}s)`,
  );

  if (!process.argv.includes("--encode-only")) {
    fresh(FRAMES_DIR);
    await captureFrames(plan);
  }

  const audio = withAudio
    ? buildTrack(
        plan.scenes.map((s) => ({ clip: s.clip, lead: s.lead, dur: s.dur })),
        {
          ffmpeg: FFMPEG,
          workDir: resolve(AUDIO_DIR, "segments"),
          out: resolve(AUDIO_DIR, "narration.wav"),
        },
      )
    : null;

  const mp4 = encodeMp4(plan.totalFrames, audio);
  writeFileSync(
    resolve(OUT_DIR, "showcase.vtt"),
    buildVtt(plan.scenes),
    "utf8",
  );

  const heroStart = plan.byId.get("establish");
  const heroEnd = plan.byId.get("nav");
  const gifSize = encodeGif({
    start: heroStart.startFrame,
    frames: heroEnd.startFrame + heroEnd.frames - heroStart.startFrame,
  });

  console.log(
    `[showcase] assets/showcase.mp4  ${(statSync(mp4).size / 1048576).toFixed(2)} MB`,
  );
  console.log(`[showcase] assets/showcase.vtt  captions`);
  console.log(
    `[showcase] static/showcase.gif  ${(gifSize / 1048576).toFixed(2)} MB`,
  );
}

async function captureFrames(plan) {
  const server = spawn(
    process.execPath,
    [resolve(ROOT, "scripts", "serve-storybook.mjs"), "--build"],
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
    const files = adoFilesMarkup({
      left: STORY_LEFT,
      top: CHROME_H,
      width: STORY_W,
      height: STORY_H,
    });
    await page.addStyleTag({
      content:
        css +
        files.css +
        `\nhtml,body{margin:0!important;padding:0!important;overflow:hidden!important;background:linear-gradient(to right,#f3f2f1 0 ${ADO_RAIL_W}px,#f8f8f8 ${ADO_RAIL_W}px ${STORY_LEFT}px,#fff ${STORY_LEFT}px calc(100% - ${SHOWCASE_GUTTER}px),#f8f8f8 calc(100% - ${SHOWCASE_GUTTER}px) 100%)!important;}` +
        `\n#storybook-root{position:absolute!important;top:${CHROME_H}px!important;left:${STORY_LEFT}px!important;width:${STORY_W}px!important;height:${STORY_H}px!important;overflow:hidden!important;}` +
        `\n#storybook-root>*{height:${STORY_H}px!important;}`,
    });
    await page.evaluate(
      ([chromeHtml, filesHtml]) => {
        const chrome = document.createElement("div");
        chrome.id = "emr-ado-chrome";
        chrome.innerHTML = chromeHtml;
        document.body.appendChild(chrome);
        const filesPanel = document.createElement("div");
        filesPanel.id = "emr-ado-files";
        filesPanel.innerHTML = filesHtml;
        document.body.appendChild(filesPanel);
      },
      [html, files.html],
    );

    await page.waitForTimeout(500);
    await page.addScriptTag({ path: OVERLAY });
    await page.evaluate(() => window.__tour.setup());
    await capture(page, plan);
  } finally {
    await browser.close();
    server.kill();
  }

  const count = readdirSync(FRAMES_DIR).filter((f) =>
    f.endsWith(".png"),
  ).length;
  if (count !== plan.totalFrames) {
    throw new Error(
      `captured ${count} frames but the narration plan expects ${plan.totalFrames}`,
    );
  }
  console.log(`[showcase] captured ${count} frames @ ${FPS}fps`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
