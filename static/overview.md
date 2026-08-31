# Easy Markdown Review

**Review Markdown like a Word doc.**

![In a pull request: highlight a sentence on the rendered page, leave a Word-style anchored comment that persists as a PR thread, and review diffs and the document outline in place](static/showcase.gif)

Markdown is perfect for docs that live next to your code: diff-friendly, auditable, and version-controlled. Its plain-text structure also makes it easy for AI agents to retrieve the right context and ground their answers in your actual documentation. But reviewing it in Azure DevOps means squinting at raw source in a diff view. Word and Loop have beautiful review UX, but your content drifts out of source control.

Easy Markdown Review gives you the best of both: a polished, rendered review experience on top of the Markdown that already lives in your repo.

---

## ✍️ Comment on the rendered page, not the raw diff

A **Markdown Review** tab appears on every pull request that touches a `.md` file. Highlight any sentence on the beautifully rendered page and drop a comment right on it — exactly like reviewing in Word.

The commenting model is intentionally **document-style**: comments sit in the margin next to the prose they're about, the way they do in Word, Google Docs, and the Office apps — not stacked at the bottom of a diff. It's review UX your team already knows.

- Threads pin to the surrounding prose with a stable text anchor, so they **survive edits and re-wordings**.
- New comments from teammates appear **without a reload**.

## 📊 Rich rendering out of the box

- **Mermaid diagrams** render inline — both GitHub <code>```mermaid</code> and Azure DevOps `:::mermaid` fences. Pop open the source any time.
- Clean typography, collapsible sections, and a navigable outline of the whole document.
- **@mentions, #work-items, and !pull-requests** become real, clickable links.
- Fully **theme-aware** — light and dark follow your Azure DevOps theme.

## 🔍 See exactly what changed

The review tab highlights **added, modified, and removed** content right on the rendered page, so reviewers focus on the diff that matters instead of scrolling raw text.

- **Word-level edits** show removed and added text inline, including changes inside headings, lists, quotes, and code blocks.
- **Formatting and structure changes** call out bold, italic, inline code, heading levels, list styles, and checklist state without painting the whole paragraph.
- **Tables stay readable**: changed cells are highlighted in place, while added or removed rows and columns remain aligned with the table.
- **Links, images, code fences, and Mermaid diagrams** expose destination, metadata, language, option, and source changes that a plain text diff makes hard to spot.
- **Deleted content** appears where it was removed, rendered as Markdown; broader rewrites offer the previous version for comparison.

## 📚 Your repository is the wiki — the Documents hub

Use the top-level **Documents** hub as a repository-native replacement for Azure DevOps Wiki. There is no wiki to create, separate repository to configure, or parallel hierarchy to maintain: the hub automatically presents the Markdown that already exists across your project repositories, with fast repo, folder, and document navigation.

You can also comment directly on a document without manually opening a pull request. Comments route to the most recent completed PR that changed that document, keeping the discussion in Azure DevOps and connected to the document's real source history.
