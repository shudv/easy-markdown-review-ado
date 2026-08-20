# Threat Model — Easy Markdown Review

_Last updated: 2026-05-20. Maintained alongside the code; update on every PR that changes a trust boundary, an external dependency, or the data persisted by the extension._

## 1. System overview

Easy Markdown Review is a client-side Azure DevOps extension. It ships as a packaged `.vsix` to the Visual Studio Marketplace and is installed into an ADO organization by an administrator. Once installed it contributes two surfaces:

| Surface                                                                                                                                   | Contribution point                                  | Iframe entry                     |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------- |
| **PR tab** — renders Markdown files in a Pull Request alongside anchored review comments                                                  | `ms.vss-code-web.pull-request-tabs`                 | `src/pr-tab/pr-tab.html`         |
| **Documents hub** — a top-level project hub that browses a repo's Markdown files and renders one in a focused reader with inline comments | `ms.vss-web.hub` (in our own `documents-hub-group`) | `src/hub/markdownReviewHub.html` |

Both surfaces are pure browser code: TypeScript + React + a unified-ecosystem Markdown pipeline, bundled by webpack. There is **no extension-owned backend**; all persistence and identity is delegated to the hosting ADO organization.

## 2. Architecture and trust boundaries

```
+--------------------------------------------------------------------+
|  ADO web app   (https://<org>.visualstudio.com / dev.azure.com)    |
|                                                                    |
|  +------ EMR iframe (sandboxed origin, gallerycdn.vsassets.io) --+ |
|  |                                                               | |
|  |  PR-tab / in-context-reader React app                         | |
|  |    ├─ markdown pipeline (unified → remark → rehype)           | |
|  |    │     - parse5 raw HTML + inert element/attribute allowlist| |
|  |    │     - rehypeSanitizeUrls (scheme allowlist)              | |
|  |    ├─ anchor + highlight (DOM-text-only, no HTML construction)| |
|  |    └─ azure-devops-extension-sdk    ◄── postMessage ──┐       | |
|  |                                                       │       | |
|  +-------------------------------------------------------|-------+ |
|                                                          │         |
|                       trust boundary  (host ↔ iframe)    │         |
|                                                          ▼         |
|  ADO host frame  ──── HTTPS REST ────► ADO services                |
|                                          (Git, PR Threads,         |
|                                           Identities, WIT)         |
+--------------------------------------------------------------------+
```

**Trust boundaries**:

1. **Host ↔ iframe (postMessage via the extension SDK).** The iframe trusts only messages mediated by `azure-devops-extension-sdk`. The extension does **not** register any of its own `window.addEventListener('message', …)` handlers.
2. **Iframe ↔ ADO REST API (HTTPS).** All outbound calls flow through `azure-devops-extension-api` clients, which use the host-issued access token. The extension never sees or stores a raw token, PAT, or credential.
3. **Iframe ↔ user-controlled Markdown content.** Every Markdown body — file content, PR comment, composer preview — is treated as untrusted input. It traverses the sanitizing pipeline before reaching `innerHTML` / `dangerouslySetInnerHTML`.

## 3. Assets

| Asset                               | Sensitivity                               | Owner                                                                                |
| ----------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------ |
| User's ADO session token            | High                                      | ADO host; the extension only receives short-lived audience-scoped tokens via the SDK |
| Repository content (Markdown files) | Medium — may contain internal design info | ADO Git                                                                              |
| PR review comments and threads      | Medium                                    | ADO PR Threads service                                                               |
| Section-collapse UI state           | Negligible                                | `sessionStorage`, keyed by file path                                                 |
| Telemetry events (IDs + counters)   | Low — pseudonymized, no content/names     | 1DS sink (see §8); disabled unless an ingestion key is configured at build time      |

The extension stores no user identity, no PII, and no secrets. It emits **privacy-preserving product telemetry only** (see §8): opaque resource IDs, hashed pull-request IDs, and numeric counters. It never transmits document text, file or repository **names**, comment bodies, search queries, user identities, or tokens. Telemetry is **off by default** and only egresses when an ingestion key is injected at build time.

## 4. Data flow

1. The host loads the iframe with a one-time configuration object describing the current PR / repo / file.
2. The iframe initializes the SDK, requests an access token, and uses ADO REST clients to fetch file contents and comment threads.
3. Markdown source flows into the renderer:
   ```
   md (string) ─► remark-parse ─► remark-gfm ─► remark-rehype (raw nodes retained)
                                ─► rehypeSafeHtml (parse5 + tag/attribute allowlist)
                                ─► rehypeSourcePositions (adds data-source-line)
                                ─► rehypeMentions (strips href on `mention://` links)
                                ─► rehypeCollapsibleSections (wraps headings in <section>)
                                ─► rehypeSanitizeUrls (scrubs href/src schemes)
                                ─► rehype-stringify ─► HTML string
   ```
4. The HTML string is mounted into a React-managed container via `dangerouslySetInnerHTML` (or imperatively via `Element.innerHTML` in the article-view layout effect).
5. Comment mutations (create / reply / edit / delete / status) flow back through `adoCommentApi.ts` to the ADO PR Threads REST endpoints; the optimistic UI reducer is updated on success.
6. When telemetry is enabled, the facade in `src/telemetry/` emits sanitized events to the configured sink (1DS). This is the only additional outbound channel and is described in §8.

Except for telemetry, there is no other inbound or outbound channel. The extension does not open WebSockets, EventSources, popups, or worker threads.

## 5. STRIDE analysis

| #   | Threat                                                                                                                                                                         | Vector                                                             | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Residual                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| S1  | **Spoofing** — a malicious page claims to be the ADO host and feeds the iframe forged config / comment data                                                                    | Cross-origin postMessage                                           | The extension only consumes messages routed through `azure-devops-extension-sdk`, which enforces the host origin. No custom `message` listeners are registered.                                                                                                                                                                                                                                                                                                                                                                                 | Trust in the SDK is absolute — vetted vendor code.                      |
| T1  | **Tampering** — markdown source crafted to inject script                                                                                                                       | `<script>`, `<iframe>`, inline event handlers smuggled as raw HTML | `rehypeSafeHtml` parses raw fragments with `parse5`, retains only inert documentation tags, and applies a per-tag attribute allowlist. Script/style/template/embed subtrees, event handlers, inline styles, and unknown attributes are dropped before serialization. Unknown wrappers are flattened to safe children. Regression tests cover details/card markup and malicious attributes.                                                                                                                                                      | The allowlist must remain narrow when adding new documentation markup.  |
| T2  | **Tampering / XSS** — markdown source uses a dangerous URL scheme on a link or image (`javascript:`, `vbscript:`, `data:text/html`, `data:image/svg+xml` with embedded script) | `[click](javascript:…)`, `![x](data:…)`                            | `rehypeSanitizeUrls` enforces an allowlist of schemes per-tag: `<a href>` → `http(s)`, `mailto`, `tel`, `ftp`, `sftp`, `mention`, plus fragments and relative paths; `<img src>` → `http(s)` only. Blocked attributes are removed and the element is tagged `data-emr-blocked-scheme` for diagnostics. Covered by 13 dedicated tests.                                                                                                                                                                                                           | None known.                                                             |
| T3  | **Tampering** — comment body persisted into ADO PR Threads is malicious                                                                                                        | Same surface as T1/T2, but on the read path                        | All comment bodies go back through the same `renderMarkdown` / `renderMarkdownSync` pipeline before reaching the DOM. There is no separate "trusted source" path.                                                                                                                                                                                                                                                                                                                                                                               | Same as T1/T2 — covered.                                                |
| R1  | **Repudiation** — a reviewer denies leaving a comment                                                                                                                          | n/a                                                                | All writes go through the ADO PR Threads service, which records author + timestamp under the actor's ADO identity. The extension never writes under a different identity.                                                                                                                                                                                                                                                                                                                                                                       | Inherits ADO's audit model.                                             |
| I1  | **Information disclosure** — markdown image references an attacker-controlled host, leaking that the document was viewed (referer / IP)                                        | `![beacon](https://attacker.example/pixel.png)`                    | Out-of-scope by design: image embedding is a legitimate feature. The ADO host's iframe-CSP `img-src` policy bounds this. The extension does not add a `referrerpolicy` override — it inherits the host's default.                                                                                                                                                                                                                                                                                                                               | Accepted residual risk; analogous to GitHub-flavored markdown.          |
| I2  | **Information disclosure** — the extension exfiltrates document content to a third party                                                                                       | Any external `fetch` / `WebSocket` / `Image()` etc.                | The bundle contains no `fetch`, `XMLHttpRequest`, `axios`, or other ad-hoc network primitive. The only outbound channels are (a) `azure-devops-extension-api`, which targets the host org's ADO REST endpoints, and (b) the telemetry sink (§8), which emits only sanitized, pseudonymized IDs and counters — never content, names, queries, or identities. A central sanitizer (`src/telemetry/sanitize.ts`) is the backstop that strips any disallowed key/value before egress. Telemetry is off unless a key is configured at build time.    | Telemetry payloads are ID/counter-only by construction and unit-tested. |
| I4  | **Information disclosure** — telemetry inadvertently carries PII (file/repo names, comment text, search queries, user identity)                                                | A new event author adds a property containing sensitive data       | The telemetry facade routes **all** event/exception properties through `sanitizeProperties`, which (1) rejects keys matching a deny-list (`name`, `path`, `email`, `title`, `url`, `body`, `text`, `content`, `author`, `user`, `query`, `file`, `comment`, …), (2) rejects values that look like emails, paths, or free text (whitespace / length > 64), and (3) hashes pull-request IDs via FNV-1a. Event builders only ever pass IDs and numeric counters. Covered by `test/telemetry.sanitize.test.ts` and `test/telemetry.facade.test.ts`. | None known — deny-by-default sanitizer.                                 |
| I3  | **Information disclosure** — sensitive state lives in browser storage                                                                                                          | `localStorage` / `cookie` / `sessionStorage`                       | Only UI state (per-section "collapsed" flag) is written, under the namespaced key `emr.section.<file>.<sectionId>`. No tokens, identities, or comment content are persisted.                                                                                                                                                                                                                                                                                                                                                                    | None known.                                                             |
| D1  | **Denial of service** — pathological markdown causes runaway rendering                                                                                                         | Deeply nested headings; very large files                           | Rendering is synchronous within a single iframe and only ever affects that user's tab. The pipeline is the standard unified stack used by GitHub-flavored renderers; no exponential backtracking is known.                                                                                                                                                                                                                                                                                                                                      | Accepted — same exposure as any markdown renderer.                      |
| E1  | **Elevation of privilege** — the extension acts beyond its declared scopes                                                                                                     | Manifest scopes vs runtime API usage                               | `vss-extension.json` declares only `vso.code` (read access for rendering files / diffs / PRs) and `vso.threads_full` (read & write PR comment threads). It no longer requests `vso.code_write`. The extension does not request or use any other scope. ADO enforces this on the issued tokens.                                                                                                                                                                                                                                                  | None known.                                                             |
| E2  | **Elevation of privilege** — supply-chain attack via a transitive npm dependency that injects code at runtime                                                                  | Compromised Markdown/unified parser dependency                     | The extension's runtime dependency surface is intentionally small and pinned in `package-lock.json`; `parse5` is the established HTML parser already used by the toolchain. Packages ship without install-time scripts. CI runs the platform's dependency checks and Dependabot is enabled.                                                                                                                                                                                                                                                     | Accepted — same exposure as any npm-based extension.                    |

## 6. Defense-in-depth summary

| Layer                   | Control                                                              | Status          |
| ----------------------- | -------------------------------------------------------------------- | --------------- |
| Manifest scopes         | Only `vso.code` + `vso.threads_full` requested                       | Enforced by ADO |
| Markdown raw HTML       | `parse5` + inert tag/attribute allowlist; dangerous subtrees dropped | Tested          |
| Markdown URL schemes    | `rehypeSanitizeUrls` allowlist                                       | Tested          |
| External network        | All I/O via host SDK; telemetry sink ID/counter-only, off by default | Grep-enforced   |
| Telemetry privacy       | Deny-by-default sanitizer; hashed PR IDs; no names/content/queries   | Tested          |
| Inline scripts / `eval` | None                                                                 | Grep-enforced   |
| Browser storage         | `sessionStorage` only; UI state only                                 | Reviewed        |
| Boot-failure UI         | Hand-built `innerHTML` escapes the error detail with `escapeHtml`    | Reviewed        |
| Iframe sandbox          | Host applies its own CSP, `sandbox` flags, and X-Frame-Options       | Inherited       |

## 8. Telemetry privacy model

Telemetry is implemented behind a vendor-neutral facade (`src/telemetry/`). Application code imports only the `../telemetry` barrel — it never references a concrete vendor SDK — so the sink is swappable. The default/confirmed sink is **1DS (One Data Strategy)**; until an ingestion key is configured at build time, telemetry runs on a **no-op sink** and nothing leaves the iframe.

**What is collected**

- Opaque resource IDs: project ID, repository ID (the ADO **IDs**, not names).
- Hashed pull-request ID (FNV-1a, 8-hex), so the raw PR number is never transmitted.
- A per-load random session ID and the app name/version.
- Engagement events as fixed names plus numeric counters only, e.g. `comment.created` (`bodyLength`, `anchorKind` enum), `comment.replied`, `file.opened` (`source` enum), `repo.switched`, `search.performed` (`queryLength`, `resultCount`, `succeeded`).
- Error/exception events: message + stack from caught/global errors, with a `handled` flag. React render failures are caught by an `ErrorBoundary` and reported with only a `hasComponentStack` boolean.

Events are grouped into two **thematic tables** — `Engagement` (user-triggered
actions) and `Diagnostics` (app/system observations: boot timing, auth failures,
exceptions) — with the specific event carried in a `name` column. That `name` is
always a **fixed value from the event catalog** ([events.ts](../src/telemetry/events.ts)),
never free text, so the grouping changes only how signals are _stored_, not what
is collected. See [docs/telemetry-tables.md](./telemetry-tables.md) for the full
model and the legacy → thematic migration. The deny-by-default sanitizer below
still validates every payload regardless of table.

**What is never collected**

- File contents, repository or file **names**, comment bodies, search **query text**, user identity, email, tokens, or any free-form string.

**Controls**

- **Deny-by-default sanitizer** (`sanitize.ts`): every property key and value is validated before reaching a sink; disallowed keys (PII-suggesting substrings) and values (emails, paths, whitespace, length > 64) are dropped. This is the last line of defense even if an event author makes a mistake.
- **Off by default**: the sink only egresses when `TELEMETRY_KEY` is injected at build time (webpack `DefinePlugin` → `__EMR_TELEMETRY_CONFIG__`). No key ⇒ no-op sink.
- **No cookies / no auto-capture**: the 1DS sink is configured with `disableCookiesUsage` and auto-capture (page-view/click) turned off, so no ambient browsing data is gathered.
- **Never throws**: all sink and facade methods are wrapped so telemetry can never affect the user-facing app.

## 9. Out of scope

- **Browser zero-days** in the rendering engine. Out of any web app's control.
- **A malicious ADO administrator** with `Manage extensions` permission could install a compromised build. Trust in the publisher is required.
- **A malicious commit author** can author markdown that displays misleading content (e.g. impersonating system messages via styled headings). This is a content-trust problem, not a code-execution problem.

## 10. Reporting security issues

See [SECURITY.md](../SECURITY.md).
