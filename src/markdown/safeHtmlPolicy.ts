export const SAFE_HTML_TAGS = new Set([
  "a",
  "br",
  "caption",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "i",
  "img",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "small",
  "span",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

export const DROP_HTML_SUBTREE_TAGS = new Set([
  "iframe",
  "object",
  "script",
  "style",
  "template",
]);

export const VOID_HTML_TAGS = new Set(["br", "img"]);

export const SAFE_HTML_CLASS =
  /^(?:card|card-grid|docs-action|codicon(?:-[a-z0-9-]+)?|markdown-alert(?:-[a-z]+)?)$/;
