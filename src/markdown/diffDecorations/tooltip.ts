// Accessible hover/focus explanation tooltips for amber changes.

import {
  DIFF_SUPPRESSED_TITLE_CLASS,
  DIFF_TOOLTIP_CLASS,
  DIFF_TOOLTIP_RIGHT_CLASS,
} from "./shared";

export function applyDiffTooltip(target: HTMLElement, label: string): void {
  target.dataset.diffTooltipHadTitle = String(target.hasAttribute("title"));
  target.dataset.diffTooltipPreviousTitle = target.getAttribute("title") ?? "";
  target.dataset.diffTooltipHadTabindex = String(
    target.hasAttribute("tabindex"),
  );
  target.dataset.diffTooltipPreviousTabindex =
    target.getAttribute("tabindex") ?? "";
  target.dataset.diffTooltipHadDescription = String(
    target.hasAttribute("aria-description"),
  );
  target.dataset.diffTooltipPreviousDescription =
    target.getAttribute("aria-description") ?? "";
  target.classList.add(DIFF_TOOLTIP_CLASS);
  target.dataset.diffTooltip = label;
  target.dataset.diffAmberMode = "explained";
  target.setAttribute("aria-description", label);
  target.removeAttribute("title");
  if (!target.hasAttribute("tabindex")) target.tabIndex = 0;
  target.addEventListener("pointerenter", alignDiffTooltip);
  target.addEventListener("focus", alignDiffTooltip);
}

export function alignDiffTooltip(event: Event): void {
  const target = event.currentTarget as HTMLElement;
  const article = target.closest<HTMLElement>(".emr-rendered");
  if (!article) return;
  const targetRect = target.getBoundingClientRect();
  const articleRect = article.getBoundingClientRect();
  const targetCenter = targetRect.left + targetRect.width / 2;
  const articleCenter = articleRect.left + articleRect.width / 2;
  target.classList.toggle(
    DIFF_TOOLTIP_RIGHT_CLASS,
    targetCenter > articleCenter,
  );
}

export function suppressNativeTitle(target: HTMLElement): void {
  target.classList.add(DIFF_SUPPRESSED_TITLE_CLASS);
  target.dataset.diffTooltipPreviousTitle = target.getAttribute("title")!;
  target.removeAttribute("title");
}
