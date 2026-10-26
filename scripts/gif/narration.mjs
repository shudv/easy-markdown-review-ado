/*
 * Narration script for the showcase video.
 *
 * One entry per scene. `say` is what the voice reads; the on-screen copy lives
 * in the timeline (scripts/gif/build-showcase.mjs) and is deliberately shorter
 * than the narration so the frame never turns into subtitles.
 *
 * Scene length is derived from the *measured* length of the audio clip (see
 * scripts/gif/tts.mjs), so picture and voice can never drift apart.
 * `lead`/`tail` are the seconds of silence held before and after the line.
 *
 * To narrate it yourself, record one file per `id` into assets/narration/
 * (`problem-a.wav`, `problem-b.wav`, …) and run `npm run video:showcase`.
 * Anything you haven't recorded falls back to the synthetic voice below, and
 * the timeline re-times itself around whatever you supply.
 * `npm run narration:script` prints the lines to read, with target lengths.
 *
 * Build-time asset generator only — not shipped in the extension.
 */

// Synthetic voice, used for any line with no recording in assets/narration/.
// Override without editing this file:
//   $env:EMR_VOICE = "en-US-EmmaMultilingualNeural"; npm run video:showcase
// `npm run narration:voices` renders the shortlist below so you can pick by ear.
export const VOICE = {
  // Newest-generation model: handles the contractions this script leans on
  // without flattening them. Nudged faster than default so the read sounds
  // like someone explaining their own work rather than narrating a documentary.
  name: process.env.EMR_VOICE || "en-US-BrianMultilingualNeural",
  rate: process.env.EMR_VOICE_RATE || "+6%",
  pitch: process.env.EMR_VOICE_PITCH || "+0Hz",
};

// Candidates that suit a product demo: conversational rather than newsreader.
export const VOICE_SHORTLIST = [
  ["en-US-BrianMultilingualNeural", "brighter, chattier male — current pick"],
  ["en-US-AndrewMultilingualNeural", "warm, casual male"],
  ["en-US-AvaMultilingualNeural", "confident, natural female"],
  ["en-US-EmmaMultilingualNeural", "warm, understated female"],
  ["en-US-SteffanNeural", "calm documentary narrator"],
  ["en-US-EricNeural", "dry, measured male"],
  ["en-US-JennyNeural", "friendly, upbeat female"],
  ["en-US-ChristopherNeural", "authoritative male"],
  ["en-GB-RyanNeural", "British male"],
  ["en-GB-SoniaNeural", "British female"],
];

// Read by `narration:voices` — long enough to hear cadence, not just timbre.
export const VOICE_SAMPLE =
  "But the way we review it never really caught up. You open the Files tab, and you're reading markup. So we built Easy Markdown Review.";

export const SCRIPT = [
  {
    id: "problem-a",
    lead: 0.45,
    tail: 0.45,
    say: "Markdown is how we write almost everything now. Design docs, runbooks, agent instructions.",
  },
  {
    id: "problem-b",
    lead: 0.3,
    tail: 0.5,
    say: "But the way we review it never really caught up. You open the Files tab, and you're reading markup. The only prose change here is one character, buried inside a link.",
  },
  {
    id: "problem-c",
    lead: 0.25,
    tail: 0.6,
    say: "So you flip to preview. Now you can see the page, but not what changed. And there's nothing here to comment on. So you flip back.",
  },
  {
    id: "solution",
    lead: 0.5,
    tail: 0.9,
    say: "So we built Easy Markdown Review.",
  },
  {
    id: "establish",
    lead: 0.3,
    tail: 0.6,
    say: "It puts a review tab on every pull request that touches Markdown. Your document, rendered, right where the review already happens.",
  },
  {
    id: "select",
    lead: 0.25,
    tail: 0.45,
    say: "Highlight a sentence, anywhere on the page.",
  },
  {
    id: "compose",
    lead: 0.2,
    tail: 0.4,
    say: "Leave a comment the way you would in a Word doc.",
  },
  {
    id: "submit",
    lead: 0.25,
    tail: 0.7,
    say: "It posts as a real pull request comment, anchored to the exact words you picked, so it stays put when the author rewrites the paragraph.",
  },
  {
    id: "diffs",
    lead: 0.3,
    tail: 0.7,
    say: "Changes show up in place. A link that moved. A row that was added. A row that's gone. You read the meaning, not the markup.",
  },
  {
    id: "nav",
    lead: 0.3,
    tail: 0.7,
    say: "And every file and every heading is one click away.",
  },
  {
    id: "value",
    lead: 0.4,
    tail: 0.7,
    say: "Here's why that matters. Reviewers stop skipping the docs. Feedback gets specific. And the teams who've moved over tell us they won't go back to reviewing prose in a diff.",
  },
  {
    id: "traction",
    lead: 0.4,
    tail: 0.8,
    say: "This isn't a prototype. It's shipped, and it's running across fifteen Azure DevOps organizations at Microsoft, with hundreds of engineers on it every day.",
  },
  {
    id: "outro",
    lead: 0.5,
    tail: 1.4,
    say: "Easy Markdown Review. Review Markdown like a document, inside Azure DevOps.",
  },
];
