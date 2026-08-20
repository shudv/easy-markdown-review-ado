// GitHub-style emoji shortcode support (`:eyes:` → 👀).
//
// Implemented as a remark plugin that rewrites `:shortcode:` runs inside mdast
// `text` nodes. Because it visits `text` nodes only, shortcodes inside inline
// code (`` `:eyes:` ``) and fenced code blocks are left untouched — they are
// `inlineCode` / `code` nodes, not `text`.
//
// Deliberately dependency-free with a curated map of the shortcodes people
// actually use in PR reviews, rather than pulling the full gemoji dataset. An
// unknown shortcode is left verbatim, so `:not_an_emoji:` renders literally.

import { visit } from "unist-util-visit";
import type { Plugin } from "unified";
import type { Root, Text } from "mdast";

/** Curated GitHub shortcode → emoji map (common review/reaction set). */
export const EMOJI_SHORTCODES: Readonly<Record<string, string>> = {
  // Reactions / voting
  "+1": "👍",
  thumbsup: "👍",
  "-1": "👎",
  thumbsdown: "👎",
  eyes: "👀",
  tada: "🎉",
  rocket: "🚀",
  fire: "🔥",
  heart: "❤️",
  sparkles: "✨",
  clap: "👏",
  pray: "🙏",
  muscle: "💪",
  ok_hand: "👌",
  wave: "👋",
  raised_hands: "🙌",
  point_up: "☝️",
  point_right: "👉",
  // Faces
  smile: "😄",
  smiley: "😃",
  grin: "😁",
  laughing: "😆",
  joy: "😂",
  rofl: "🤣",
  wink: "😉",
  blush: "😊",
  thinking: "🤔",
  sweat_smile: "😅",
  sunglasses: "😎",
  neutral_face: "😐",
  confused: "😕",
  cry: "😢",
  sob: "😭",
  scream: "😱",
  angry: "😠",
  rage: "😡",
  tired_face: "😫",
  facepalm: "🤦",
  shrug: "🤷",
  // Status / review
  white_check_mark: "✅",
  heavy_check_mark: "✔️",
  x: "❌",
  warning: "⚠️",
  no_entry: "⛔",
  bangbang: "‼️",
  question: "❓",
  bulb: "💡",
  memo: "📝",
  pencil: "✏️",
  bug: "🐛",
  wrench: "🔧",
  hammer: "🔨",
  construction: "🚧",
  lock: "🔒",
  unlock: "🔓",
  key: "🔑",
  zap: "⚡",
  boom: "💥",
  hourglass: "⌛",
  clock: "🕐",
  hand: "✋",
  raised_hand: "✋",
  100: "💯",
  checkered_flag: "🏁",
  dart: "🎯",
  star: "⭐",
  star2: "🌟",
  // Misc common
  coffee: "☕",
  beer: "🍺",
  cat: "🐱",
  dog: "🐶",
  poop: "💩",
  ghost: "👻",
  robot: "🤖",
  snail: "🐌",
  turtle: "🐢",
  snake: "🐍",
  package: "📦",
  books: "📚",
  book: "📖",
  link: "🔗",
  mag: "🔍",
  gear: "⚙️",
  recycle: "♻️",
  arrow_up: "⬆️",
  arrow_down: "⬇️",
  arrow_right: "➡️",
  arrow_left: "⬅️",
};

// A shortcode is `:` + name + `:`. Names are letters, digits, `_`, `+`, `-`.
// Requiring at least one char and bounding the length keeps the scan cheap and
// avoids matching things like `::` or `a:b:c` time ranges greedily.
const SHORTCODE_RE = /:([a-z0-9_+-]{1,40}):/gi;

/** Replace known `:shortcode:` runs in a string; unknown codes pass through. */
export function replaceEmojiShortcodes(text: string): string {
  if (text.indexOf(":") === -1) return text;
  return text.replace(SHORTCODE_RE, (whole, name: string) => {
    const emoji = EMOJI_SHORTCODES[name.toLowerCase()];
    return emoji ?? whole;
  });
}

/**
 * remark plugin: rewrite emoji shortcodes inside `text` nodes. Skips code
 * (fenced + inline) automatically since those are not `text` nodes.
 */
export const remarkEmoji: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "text", (node: Text) => {
      const next = replaceEmojiShortcodes(node.value);
      if (next !== node.value) node.value = next;
    });
  };
};
