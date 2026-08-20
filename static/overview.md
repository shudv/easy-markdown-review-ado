# Easy Markdown Review

**Review Markdown like a Word doc — without giving up Git.**

![In a pull request: highlight a sentence on the rendered page, leave a Word-style anchored comment that persists as a PR thread, and review diffs and the document outline in place](static/showcase.gif)

Markdown is perfect for docs that live next to your code: diff-friendly, auditable, version-controlled. But reviewing it in Azure DevOps means squinting at raw source in a diff view. Word and Loop have beautiful review UX, but your content drifts out of source control.

Easy Markdown Review gives you the best of both: a polished, rendered review experience on top of the Markdown that already lives in your repo.

---

## ✍️ Comment on the rendered page, not the raw diff

A **Markdown Review** tab appears on every pull request that touches a `.md` file. Highlight any sentence on the beautifully rendered page and drop a comment right on it — exactly like reviewing in Word.

The commenting model is intentionally **document-style**: comments sit in the margin next to the prose they're about, the way they do in Word, Google Docs, and the Office apps — not stacked at the bottom of a diff. It's review UX your team already knows.

- Threads pin to the surrounding prose with a stable text anchor, so they **survive edits and rewordings**.
- Comments from earlier PRs on the same document show up alongside live threads — **historical context never gets lost** across PR boundaries.
- New comments from teammates appear **without a reload**.

## 📊 Rich rendering out of the box

- **Mermaid diagrams** render inline — both GitHub <code>```mermaid</code> and Azure DevOps `:::mermaid` fences. Pop open the source any time.
- Clean typography, collapsible sections, and a navigable outline of the whole document.
- **@mentions, #work-items, and !pull-requests** become real, clickable links.
- Fully **theme-aware** — light and dark follow your Azure DevOps theme.

## 🔍 See exactly what changed

The review tab highlights **added, modified, and removed** content right on the rendered page, so reviewers focus on the diff that matters instead of scrolling raw text.

## A home for every doc — the Documents hub

A top-level **Documents** hub lists every Markdown file across every repo in your project, with quick repo and folder filters. The big unlock: **you can comment on any document without opening a pull request at all.** Reviewing, annotating, and discussing a doc no longer has to wait for — or be tied to — a code-review cycle. Your design docs stay alive **between** commits, not just during them.

---

## 🔒 No new infrastructure to run

Comments live in Azure DevOps as pull-request comment threads — there's no sidecar database to host, no separate identity, and no new permissions to manage. The extension works within your existing repos and access controls, and renders untrusted Markdown through a strict sanitizer.

**Git stays the single source of truth.** Install it, open a PR with a Markdown file, and start reviewing.
