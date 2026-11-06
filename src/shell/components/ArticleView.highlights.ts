// Comment-highlight state shared by `ArticleView`'s wrap pass and its
// pointer/keyboard handlers: active/hover classes and keyboard targets.

export const DRAFT_THREAD_ID = "__draft__";

export function syncActiveHighlights(
  article: HTMLElement,
  activeThreadId: string | null,
  land: boolean,
): void {
  const highlights = Array.from(
    article.querySelectorAll<HTMLElement>(".emr-highlight"),
  );

  highlights.forEach((highlight) => {
    const threadId = highlight.dataset.threadId;
    highlight.classList.toggle(
      "is-active",
      threadId === DRAFT_THREAD_ID || threadId === activeThreadId,
    );
    highlight.classList.remove("is-landing");
  });

  if (!land || activeThreadId === null) return;

  const activeHighlights = highlights.filter(
    (highlight) => highlight.dataset.threadId === activeThreadId,
  );

  if (activeHighlights.length === 0) return;
  void article.offsetWidth;
  activeHighlights.forEach((highlight) =>
    highlight.classList.add("is-landing"),
  );
}

export function syncHoveredHighlights(
  article: HTMLElement,
  hoveredThreadId: string | null,
): void {
  article
    .querySelectorAll<HTMLElement>(".emr-highlight")
    .forEach((highlight) =>
      highlight.classList.toggle(
        "is-hover",
        highlight.dataset.threadId === hoveredThreadId,
      ),
    );
}

export function containedThreadIds(root: HTMLElement): string[] {
  const highlights = Array.from(
    root.querySelectorAll<HTMLElement>(
      `.emr-highlight:not([data-thread-id="${DRAFT_THREAD_ID}"])`,
    ),
  ).reverse();

  highlights.push(root);

  return [
    ...new Set(highlights.map((highlight) => highlight.dataset.threadId!)),
  ];
}

export function addHighlightKeyboardTargets(article: HTMLElement): void {
  const highlights = Array.from(
    article.querySelectorAll<HTMLElement>(".emr-highlight"),
  ).filter((highlight) => highlight.dataset.threadId !== DRAFT_THREAD_ID);

  const roots = highlights.filter(
    (highlight) =>
      !highlight.parentElement?.closest(
        `.emr-highlight:not([data-thread-id="${DRAFT_THREAD_ID}"])`,
      ),
  );

  const represented = new Set<string>();
  roots.forEach((root) => {
    const threadIds = containedThreadIds(root);

    if (
      threadIds.length === 0 ||
      threadIds.every((id) => represented.has(id))
    ) {
      return;
    }

    threadIds.forEach((id) => represented.add(id));
    const anchorText = root.innerText.replace(/\s+/g, " ").trim();
    root.tabIndex = 0;
    root.setAttribute("role", "button");
    let label = "Open comment thread";

    if (threadIds.length > 1) {
      label = `Open ${threadIds.length} overlapping comment threads`;
    }

    root.setAttribute("aria-label", `${label}: ${anchorText}`);
  });
}
