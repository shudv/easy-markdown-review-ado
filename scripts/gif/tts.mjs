/*
 * Voice track for the showcase video.
 *
 * Every narration line comes from one of two places: a recording you made
 * yourself (assets/narration/<id>.wav|mp3|m4a|flac|ogg), or Microsoft Edge's
 * neural voices via the `edge-tts` client. Either way the clip is measured,
 * and the scene is built to fit it — that is what keeps picture and voice
 * locked together.
 *
 * Recordings are cleaned up before use (high-pass, silence trimmed off both
 * ends, levelled), so you can record in one take per line without worrying
 * about dead air at the start.
 *
 * Synthetic clips are cached by a hash of voice + text, so re-running the
 * build only re-synthesizes lines whose wording actually changed.
 *
 * Build-time asset generator only — not shipped in the extension.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PYTHON = process.env.EMR_PYTHON || "python";
const SR = 48000;
const TAKE_EXTENSIONS = ["wav", "mp3", "m4a", "flac", "ogg", "webm"];

function must(cmd, args, what) {
  const r = spawnSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) {
    process.stderr.write(r.stderr?.toString() ?? "");
    throw new Error(`${what} failed (${cmd} exited ${r.status})`);
  }
  return r.stdout.toString();
}

function probeDuration(ffprobe, file) {
  const out = must(
    ffprobe,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      file,
    ],
    "ffprobe",
  );
  const d = Number.parseFloat(out.trim());
  if (!Number.isFinite(d) || d <= 0)
    throw new Error(`bad duration for ${file}`);
  return d;
}

export function checkTtsAvailable() {
  const r = spawnSync(PYTHON, ["-c", "import edge_tts"], { stdio: "ignore" });
  return r.status === 0;
}

/**
 * Find a take you recorded for `id`, if there is one.
 */
function findTake(takesDir, id) {
  for (const ext of TAKE_EXTENSIONS) {
    const file = resolve(takesDir, `${id}.${ext}`);
    if (existsSync(file) && statSync(file).size > 0) return file;
  }
  return null;
}

/**
 * Clean up a recorded take: roll off rumble, trim the dead air either side of
 * the line, and level it so it sits where the synthetic voice would.
 */
function prepareTake(source, { ffmpeg, ffprobe, workDir, id }) {
  mkdirSync(workDir, { recursive: true });
  const st = statSync(source);
  const key = createHash("sha256")
    .update(`${source}|${st.size}|${st.mtimeMs}`)
    .digest("hex")
    .slice(0, 16);
  const file = resolve(workDir, `${id}-${key}.wav`);
  if (!existsSync(file)) {
    console.log(`[narration] preparing your take for "${id}" …`);
    must(
      ffmpeg,
      [
        "-y",
        "-i",
        source,
        "-af",
        [
          `aformat=sample_rates=${SR}:channel_layouts=stereo`,
          "highpass=f=85",
          // Trim silence at the head, then again at the tail via reverse.
          "silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB",
          "areverse",
          "silenceremove=start_periods=1:start_silence=0.20:start_threshold=-45dB",
          "areverse",
          "acompressor=threshold=-20dB:ratio=3:attack=12:release=200",
          "loudnorm=I=-16:TP=-1.5:LRA=11",
          `aresample=${SR}`,
        ].join(","),
        "-c:a",
        "pcm_s16le",
        file,
      ],
      `prepare take (${id})`,
    );
  }
  return { file, dur: probeDuration(ffprobe, file) };
}

/**
 * Resolve every line in `script` to an audio clip. Returns a Map of
 * id -> { file, dur, source: "you" | "synthetic" }.
 */
export function buildClips(
  script,
  voice,
  { takesDir, cacheDir, takeWorkDir, ffmpeg, ffprobe, allowSynthetic = true },
) {
  mkdirSync(cacheDir, { recursive: true });
  const clips = new Map();
  for (const beat of script) {
    const take = takesDir ? findTake(takesDir, beat.id) : null;
    if (take) {
      const prepared = prepareTake(take, {
        ffmpeg,
        ffprobe,
        workDir: takeWorkDir,
        id: beat.id,
      });
      clips.set(beat.id, { ...prepared, source: "you" });
      continue;
    }
    if (!allowSynthetic) {
      throw new Error(
        `no recording found for "${beat.id}" in ${takesDir} (expected ${beat.id}.wav)`,
      );
    }
    clips.set(beat.id, {
      ...synthesizeOne(beat, voice, cacheDir, ffprobe),
      source: "synthetic",
    });
  }
  return clips;
}

function synthesizeOne(beat, voice, cacheDir, ffprobe) {
  const key = createHash("sha256")
    .update([voice.name, voice.rate, voice.pitch, beat.say].join("\u0000"))
    .digest("hex")
    .slice(0, 16);
  const file = resolve(cacheDir, `${beat.id}-${key}.mp3`);
  if (!existsSync(file) || statSync(file).size === 0) {
    console.log(`[narration] synthesizing "${beat.id}" …`);
    // The Edge endpoint intermittently returns an empty stream; retry before
    // failing the whole build.
    for (let attempt = 1; ; attempt++) {
      try {
        must(
          PYTHON,
          [
            "-m",
            "edge_tts",
            "--voice",
            voice.name,
            // `--opt=value` form: the leading sign would otherwise parse as a flag.
            `--rate=${voice.rate}`,
            `--pitch=${voice.pitch}`,
            "--text",
            beat.say,
            "--write-media",
            file,
          ],
          `edge-tts (${beat.id})`,
        );
        break;
      } catch (err) {
        if (attempt >= 4) throw err;
        console.log(`[narration] retry ${attempt} for "${beat.id}"`);
      }
    }
  }
  return { file, dur: probeDuration(ffprobe, file) };
}

/**
 * Render one sample line in each candidate voice so it can be picked by ear.
 * Returns `[{ name, note, file, dur }]`.
 */
export function previewVoices(sample, shortlist, { voice, outDir, ffprobe }) {
  mkdirSync(outDir, { recursive: true });
  return shortlist.map(([name, note]) => {
    const clip = synthesizeOne(
      { id: name, say: sample },
      { ...voice, name },
      outDir,
      ffprobe,
    );
    return { name, note, ...clip };
  });
}

/**
 * Render the full voice track. `segments` are `{ clip, lead, dur }` in scene
 * order, where `dur` is the exact seconds of video the scene occupies.
 */
export function buildTrack(segments, { ffmpeg, workDir, out }) {
  mkdirSync(workDir, { recursive: true });
  const parts = [];
  segments.forEach((seg, i) => {
    const part = resolve(workDir, `seg-${String(i).padStart(2, "0")}.wav`);
    const delayMs = Math.round(seg.lead * 1000);
    must(
      ffmpeg,
      [
        "-y",
        "-i",
        seg.clip,
        "-af",
        [
          `aformat=sample_rates=${SR}:channel_layouts=stereo`,
          `adelay=delays=${delayMs}:all=1`,
          "apad",
          `atrim=0:${seg.dur.toFixed(6)}`,
          "asetpts=N/SR/TB",
        ].join(","),
        "-c:a",
        "pcm_s16le",
        part,
      ],
      `ffmpeg segment ${i}`,
    );
    parts.push(part);
  });

  const listFile = resolve(workDir, "segments.txt");
  writeFileSync(
    listFile,
    parts.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n"),
    "utf8",
  );
  const raw = resolve(workDir, "narration-raw.wav");
  must(
    ffmpeg,
    ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", raw],
    "ffmpeg concat",
  );

  const total = segments.reduce((a, s) => a + s.dur, 0);
  must(
    ffmpeg,
    [
      "-y",
      "-i",
      raw,
      "-af",
      [
        "highpass=f=85",
        // Even out the loud/soft swings so the voice sits steady under captions.
        "acompressor=threshold=-19dB:ratio=3:attack=12:release=200",
        "loudnorm=I=-16:TP=-1.5:LRA=11",
        `aresample=${SR}`,
        "apad",
        `atrim=0:${total.toFixed(6)}`,
        "asetpts=N/SR/TB",
      ].join(","),
      "-c:a",
      "pcm_s16le",
      out,
    ],
    "ffmpeg master",
  );
  return out;
}

/**
 * WebVTT captions for the finished video, derived from the same offsets used
 * to lay out the voice track.
 */
export function buildVtt(segments) {
  const stamp = (s) => {
    const h = String(Math.floor(s / 3600)).padStart(2, "0");
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const sec = (s % 60).toFixed(3).padStart(6, "0");
    return `${h}:${m}:${sec}`;
  };
  const lines = ["WEBVTT", ""];
  let at = 0;
  for (const seg of segments) {
    const start = at + seg.lead;
    lines.push(
      `${stamp(start)} --> ${stamp(start + seg.clipDur)}`,
      seg.say,
      "",
    );
    at += seg.dur;
  }
  return lines.join("\n");
}
