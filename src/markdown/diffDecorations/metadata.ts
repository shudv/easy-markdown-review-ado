// Indicators for non-visible metadata changes: link targets, image
// descriptions, and code-block info strings.

import { diffWords } from "../wordDiff";
import { applyInlineWordDiff } from "../wordDiffDom";
import { renderOriginalStandalone } from "./rendering";
import { DIFF_METADATA_CLASS } from "./shared";

interface LinkTargetChange {
  index: number;
  before: string;
  after: string;
  hostChanged: boolean;
}

function linkHost(value: string): string {
  try {
    return new URL(value, "https://relative.invalid").host;
  } catch {
    return "";
  }
}

export function readLinkTargets(root: Element): string[] {
  return Array.from(root.querySelectorAll<HTMLAnchorElement>("a")).map(
    (link) => link.getAttribute("href") ?? "",
  );
}

export function findLinkTargetChanges(
  before: readonly string[],
  after: readonly string[],
): LinkTargetChange[] {
  if (before.length !== after.length) return [];
  const changes: LinkTargetChange[] = [];
  for (let index = 0; index < before.length; index++) {
    if (before[index] !== after[index]) {
      changes.push({
        index,
        before: before[index]!,
        after: after[index]!,
        hostChanged: linkHost(before[index]!) !== linkHost(after[index]!),
      });
    }
  }
  return changes;
}

export function applyLinkTargetIndicators(
  root: Element,
  changes: readonly LinkTargetChange[],
): void {
  const links = Array.from(root.querySelectorAll<HTMLAnchorElement>("a"));
  for (const change of changes) {
    const link = links[change.index];
    /* v8 ignore next -- indexes come from readLinkTargets on this same target, and the word/format marks added since never add or remove anchors */
    if (!link) continue;
    const indicator = document.createElement("span");
    indicator.className = `${DIFF_METADATA_CLASS} emr-diff-metadata--link`;
    indicator.classList.toggle("is-warning", change.hostChanged);
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "emr-diff-metadata-trigger";
    trigger.setAttribute(
      "aria-label",
      change.hostChanged
        ? "Show link hostname change"
        : "Show link target change",
    );
    trigger.title = trigger.getAttribute("aria-label")!;
    trigger.appendChild(buildLinkChangeIcon());
    trigger.setAttribute("aria-expanded", "false");
    const panel = document.createElement("span");
    panel.className = "emr-diff-metadata-panel";
    panel.id = `emr-diff-metadata-panel-${root.ownerDocument.querySelectorAll(".emr-diff-metadata-panel").length + 1}`;
    panel.setAttribute("popover", "auto");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Link target change");
    trigger.setAttribute("aria-controls", panel.id);
    const targetDiff = document.createElement("span");
    targetDiff.className = "emr-diff-metadata-target-diff";
    targetDiff.textContent = change.after;
    applyInlineWordDiff(targetDiff, diffWords(change.before, change.after));
    panel.appendChild(targetDiff);
    const setOpen = (open: boolean): void => {
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        trigger.ownerDocument.defaultView!.requestAnimationFrame(() => {
          positionMetadataPanel(trigger, panel);
        });
      }
    };
    panel.addEventListener("toggle", (event) => {
      const state = (event as Event & { newState?: string }).newState;
      setOpen(state === "open");
    });
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      positionMetadataPanel(trigger, panel);
      const popover = panel as unknown as HTMLElement & {
        togglePopover?: (force?: boolean) => boolean;
      };
      const hasNativePopover = typeof popover.togglePopover === "function";
      const open = trigger.getAttribute("aria-expanded") !== "true";
      if (hasNativePopover) popover.togglePopover(open);
      else {
        indicator.classList.toggle("is-open", open);
        setOpen(open);
      }
      if (hasNativePopover) setOpen(open);
    });
    indicator.append(trigger, panel);
    link.after(indicator);
  }
}

function appendMetadataRow(
  row: HTMLElement,
  labelText: string,
  valueText: string,
): void {
  const label = document.createElement("span");
  label.className = "emr-diff-metadata-label";
  label.textContent = `${labelText} `;
  const value = document.createElement("span");
  value.className = "emr-diff-metadata-value";
  value.textContent = valueText;
  row.append(label, value);
}

function buildLinkChangeIcon(): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const first = document.createElementNS("http://www.w3.org/2000/svg", "path");
  first.setAttribute(
    "d",
    "M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 4.93",
  );
  const second = document.createElementNS("http://www.w3.org/2000/svg", "path");
  second.setAttribute(
    "d",
    "M14 11a5 5 0 0 0-7.07 0L4.8 13.12a5 5 0 0 0 7.07 7.07L13 19.07",
  );
  svg.append(first, second);
  return svg;
}

function positionMetadataPanel(trigger: HTMLElement, panel: HTMLElement): void {
  const rect = trigger.getBoundingClientRect();
  const view = trigger.ownerDocument.defaultView!;
  const viewportWidth = view.innerWidth;
  const viewportHeight = view.innerHeight;
  const desiredWidth = Math.min(440, viewportWidth - 16);
  const measuredHeight = panel.getBoundingClientRect().height;
  const panelHeight =
    measuredHeight > 0 ? measuredHeight : Math.min(320, viewportHeight - 16);
  const maximumTop = Math.max(8, viewportHeight - panelHeight - 8);
  panel.style.left = `${Math.max(8, Math.min(rect.left, viewportWidth - desiredWidth - 8))}px`;
  panel.style.top = `${Math.max(8, Math.min(rect.bottom + 6, maximumTop))}px`;
}

export function applySimpleMetadataIndicator(
  root: Element,
  label: string,
  beforeValue: string,
  afterValue: string,
): void {
  const indicator = document.createElement("span");
  indicator.className = `${DIFF_METADATA_CLASS} emr-diff-metadata--structure`;
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "emr-diff-metadata-trigger";
  trigger.textContent = label;
  trigger.setAttribute("aria-expanded", "false");
  const panel = document.createElement("span");
  panel.className = "emr-diff-metadata-panel";
  panel.setAttribute("role", "tooltip");
  const before = document.createElement("span");
  before.className = "emr-diff-metadata-row emr-diff-metadata-row--before";
  appendMetadataRow(before, "Before", beforeValue);
  const after = document.createElement("span");
  after.className = "emr-diff-metadata-row emr-diff-metadata-row--after";
  appendMetadataRow(after, "After", afterValue);
  panel.append(before, after);
  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const open = !indicator.classList.contains("is-open");
    indicator.classList.toggle("is-open", open);
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
  });
  indicator.append(trigger, panel);
  if (root.tagName === "IMG") root.after(indicator);
  else root.appendChild(indicator);
}

interface RenderedCodeMetadata {
  language: string;
  options: string;
}

function codeMetadata(pre: Element): RenderedCodeMetadata | null {
  const code = pre.querySelector("code");
  if (!code) return null;
  const languageClass = Array.from(code.classList)
    .find((name) => name.startsWith("language-"))
    ?.slice("language-".length);
  return {
    language: languageClass || "plain text",
    options:
      pre.getAttribute("data-code-meta") ??
      code.getAttribute("data-code-meta") ??
      "",
  };
}

function imageDescription(image: Element): string {
  const src = image.getAttribute("src") ?? "no source";
  const alt = image.getAttribute("alt") ?? "no alt text";
  const title = image.getAttribute("title");
  return title
    ? `${src} (alt: ${alt}; title: ${title})`
    : `${src} (alt: ${alt})`;
}

interface ImageMetadataChange {
  index: number;
  before: string;
  after: string;
}

export function findImageMetadataChanges(
  beforeRoot: Element,
  afterRoot: Element,
): ImageMetadataChange[] {
  const before = Array.from(beforeRoot.querySelectorAll("img")).map(
    imageDescription,
  );
  const after = Array.from(afterRoot.querySelectorAll("img")).map(
    imageDescription,
  );
  if (before.length !== after.length) return [];
  return before.flatMap((description, index) =>
    description === after[index]
      ? []
      : [{ index, before: description, after: after[index]! }],
  );
}

export function applyImageMetadataIndicators(
  root: Element,
  changes: readonly ImageMetadataChange[],
): void {
  const images = Array.from(root.querySelectorAll("img"));
  for (const change of changes) {
    const image = images[change.index]!;
    applySimpleMetadataIndicator(
      image,
      "Image changed",
      change.before,
      change.after,
    );
  }
}
interface CodeMetadataChange {
  label: string;
  before: string;
  after: string;
  contentUnchanged: boolean;
}

export function readCodeMetadataChange(
  block: HTMLElement,
  originalMarkdown: string,
  renderInline: (md: string) => string,
): CodeMetadataChange | null {
  const scratch = renderOriginalStandalone(
    block,
    originalMarkdown,
    renderInline,
  );
  const original = scratch.querySelector("pre");
  if (!original) return null;
  const before = codeMetadata(original);
  const after = codeMetadata(block);
  if (!before || !after) return null;
  if (before.language === after.language && before.options === after.options) {
    return null;
  }
  const languageChanged = before.language !== after.language;
  const optionsChanged = before.options !== after.options;
  return {
    label:
      languageChanged && optionsChanged
        ? "Code fence changed"
        : languageChanged
          ? "Language changed"
          : "Code options changed",
    before: describeCodeMetadata(before, languageChanged, optionsChanged),
    after: describeCodeMetadata(after, languageChanged, optionsChanged),
    contentUnchanged: original.textContent === block.textContent,
  };
}

/** One side of a code-metadata change, showing only the parts that changed. */
function describeCodeMetadata(
  meta: RenderedCodeMetadata,
  languageChanged: boolean,
  optionsChanged: boolean,
): string {
  if (!languageChanged) return meta.options || "none";
  return optionsChanged
    ? `${meta.language}; options: ${meta.options || "none"}`
    : meta.language;
}
