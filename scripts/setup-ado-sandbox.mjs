// Bootstrap the ADO sandbox for Easy Markdown Review development.
//
// Idempotent: re-running this only creates resources that don't already exist.
// Writes .ado-sandbox.json at repo root with all the IDs the build tooling needs.
//
// Usage:
//   npm run setup:sandbox       -- create everything
//   npm run verify:ado          -- just verify the PAT works, no mutations
//
// Required env vars (loaded by `node --env-file=.env`):
//   AZDO_ORG_URL, AZDO_TEST_PROJECT
// Authentication: AZDO_BEARER_TOKEN (short-lived) or AZDO_PAT.

import { writeFile, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..");
const SANDBOX_META_PATH = join(REPO_ROOT, ".ado-sandbox.json");
const SANDBOX_DIR = join(REPO_ROOT, "sandbox");
const MANIFEST_PATH = join(SANDBOX_DIR, "manifest.json");

// ---------- env ----------

const ORG_URL = required("AZDO_ORG_URL").replace(/\/+$/, "");
const BEARER_TOKEN = process.env.AZDO_BEARER_TOKEN?.trim();
const PAT = process.env.AZDO_PAT?.trim();
if (!BEARER_TOKEN && !PAT) required("AZDO_PAT");
const PROJECT_NAME = process.env.AZDO_TEST_PROJECT ?? "markdown-review-sandbox";
const VERIFY_ONLY = process.argv.includes("--verify-only");

function required(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    console.error(`✘ Missing required env var: ${name}`);
    console.error("  Copy .env.example to .env and fill it in.");
    process.exit(1);
  }
  return v.trim();
}

// ---------- ADO REST helper ----------

const AUTH_HEADER = BEARER_TOKEN
  ? `Bearer ${BEARER_TOKEN}`
  : "Basic " + Buffer.from(`:${PAT}`, "utf8").toString("base64");

/**
 * Call an Azure DevOps REST endpoint.
 * @param {string} method
 * @param {string} url - Absolute URL.
 * @param {object} [opts]
 * @param {object} [opts.body] - JSON-serialisable body.
 * @param {BodyInit} [opts.rawBody] - Raw request body (for binary uploads).
 * @param {Record<string,string>} [opts.headers]
 * @param {number[]} [opts.allowStatus] - Non-2xx statuses to return without throwing.
 * @returns {Promise<{status:number, headers:Headers, body:any, raw:string}>}
 */
async function ado(method, url, opts = {}) {
  if (opts.body !== undefined && opts.rawBody !== undefined) {
    throw new Error("ado request cannot specify both body and rawBody");
  }
  const hasJsonBody = opts.body !== undefined;
  const headers = {
    Authorization: AUTH_HEADER,
    Accept: "application/json",
    ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
    ...opts.headers,
  };
  const res = await fetch(url, {
    method,
    headers,
    body: hasJsonBody ? JSON.stringify(opts.body) : opts.rawBody,
  });
  const raw = await res.text();
  let body = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  }
  const allow = opts.allowStatus ?? [];
  if (!res.ok && !allow.includes(res.status)) {
    const msg = body?.message || body?.value?.Message || raw || res.statusText;
    throw new AdoError(
      `${method} ${shortUrl(url)} → ${res.status} ${res.statusText}\n  ${msg}`,
      res.status,
      body,
    );
  }
  return { status: res.status, headers: res.headers, body, raw };
}

class AdoError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "AdoError";
    this.status = status;
    this.body = body;
  }
}

function shortUrl(u) {
  return u.replace(ORG_URL, "<org>");
}

// ---------- logging ----------

const log = {
  step: (msg) => console.log(`\n▸ ${msg}`),
  info: (msg) => console.log(`  ${msg}`),
  ok: (msg) => console.log(`  ✓ ${msg}`),
  warn: (msg) => console.log(`  ! ${msg}`),
  err: (msg) => console.error(`  ✘ ${msg}`),
};

// ---------- phases ----------

async function verifyConnection() {
  log.step("Verifying authentication against ADO");
  const { body } = await ado(
    "GET",
    `${ORG_URL}/_apis/connectionData?api-version=7.1-preview.1`,
  );
  const user = body?.authenticatedUser;
  const display =
    user?.providerDisplayName || user?.customDisplayName || user?.id;
  if (!display) {
    throw new Error("connectionData returned no authenticated user");
  }
  log.ok(`Authenticated as: ${display}`);
  log.ok(`Org host: ${shortUrl(ORG_URL)}`);
  return { userId: user?.id, displayName: display };
}

async function getBasicProcessTemplateId() {
  log.step("Resolving 'Basic' process template");
  const { body } = await ado(
    "GET",
    `${ORG_URL}/_apis/process/processes?api-version=7.1-preview.1`,
  );
  const processes = body?.value ?? [];
  const basic = processes.find((p) => (p.name || "").toLowerCase() === "basic");
  if (!basic) {
    const names = processes.map((p) => p.name).join(", ");
    throw new Error(
      `'Basic' process template not found. Available: ${names || "(none)"}`,
    );
  }
  log.ok(`Basic templateId: ${basic.id}`);
  return basic.id;
}

async function getProjectByName(name) {
  const { body, status } = await ado(
    "GET",
    `${ORG_URL}/_apis/projects/${encodeURIComponent(name)}?api-version=7.1`,
    { allowStatus: [404] },
  );
  if (status === 404) return null;
  return body;
}

async function ensureProject() {
  log.step(`Ensuring project: ${PROJECT_NAME}`);
  const existing = await getProjectByName(PROJECT_NAME);
  if (existing) {
    log.ok(`Project already exists (id=${existing.id})`);
    return existing;
  }
  log.info("Project not found; creating…");
  const processTemplateId = await getBasicProcessTemplateId();
  const { body: op } = await ado(
    "POST",
    `${ORG_URL}/_apis/projects?api-version=7.1`,
    {
      body: {
        name: PROJECT_NAME,
        description:
          "Sandbox for Easy Markdown Review ADO extension development.",
        visibility: "private",
        capabilities: {
          versioncontrol: { sourceControlType: "Git" },
          processTemplate: { templateTypeId: processTemplateId },
        },
      },
    },
  );
  if (!op?.url) {
    throw new Error(
      `Unexpected response from project create: ${JSON.stringify(op)}`,
    );
  }
  log.info(`Waiting for project creation operation: ${op.id}`);
  await waitForOperation(op.url);
  // Re-fetch the now-created project for its IDs.
  const created = await getProjectByName(PROJECT_NAME);
  if (!created) {
    throw new Error("Project create reported success but project not found.");
  }
  log.ok(`Project created (id=${created.id})`);
  return created;
}

async function waitForOperation(opUrl, timeoutMs = 90_000) {
  const start = Date.now();
  let lastStatus = "";
  while (Date.now() - start < timeoutMs) {
    const { body } = await ado(
      "GET",
      `${opUrl}${opUrl.includes("?") ? "&" : "?"}api-version=7.1-preview.1`,
    );
    const status = body?.status;
    if (status !== lastStatus) {
      log.info(`  operation status: ${status}`);
      lastStatus = status;
    }
    if (status === "succeeded") return body;
    if (status === "failed" || status === "cancelled") {
      throw new Error(
        `Operation ${status}: ${JSON.stringify(body?.resultMessage || body)}`,
      );
    }
    await sleep(1500);
  }
  throw new Error(`Operation timed out after ${timeoutMs}ms`);
}

async function ensureNamedRepo(projectId, name) {
  log.step(`Ensuring repo: ${name}`);
  const find = async () => {
    const { body } = await ado(
      "GET",
      `${ORG_URL}/${encodeURIComponent(
        PROJECT_NAME,
      )}/_apis/git/repositories?api-version=7.1`,
    );
    return (body?.value ?? []).find((r) => r.name === name) ?? null;
  };
  let repo = await find();
  if (repo) {
    log.ok(`Repo exists (id=${repo.id})`);
    return repo;
  }
  log.info("Repo not found; creating…");
  await ado(
    "POST",
    `${ORG_URL}/${encodeURIComponent(
      PROJECT_NAME,
    )}/_apis/git/repositories?api-version=7.1`,
    { body: { name, project: { id: projectId } } },
  );
  // The default project repo can take a moment to appear; new repos are usually
  // immediate, but retry to be safe.
  for (let i = 0; i < 10; i++) {
    repo = await find();
    if (repo) {
      log.ok(`Repo created (id=${repo.id})`);
      return repo;
    }
    log.info(`Repo not yet visible, retrying (${i + 1}/10)…`);
    await sleep(1500);
  }
  throw new Error(`Repo ${name} not visible after creation.`);
}

async function getBranchHead(repoId, branch) {
  // Use the refs endpoint: it returns an empty array for empty repos (no 400)
  // and is the canonical way to ask "does this branch exist, and at what commit?".
  const filter = `heads/${branch}`;
  const { body } = await ado(
    "GET",
    `${ORG_URL}/${encodeURIComponent(
      PROJECT_NAME,
    )}/_apis/git/repositories/${repoId}/refs?filter=${encodeURIComponent(
      filter,
    )}&api-version=7.1`,
  );
  const refs = body?.value ?? [];
  const match = refs.find((r) => r.name === `refs/heads/${branch}`);
  return match?.objectId ?? null;
}

async function pushCommit(repoId, refName, oldObjectId, commit) {
  const { body } = await ado(
    "POST",
    `${ORG_URL}/${encodeURIComponent(
      PROJECT_NAME,
    )}/_apis/git/repositories/${repoId}/pushes?api-version=7.1`,
    {
      body: {
        refUpdates: [{ name: refName, oldObjectId }],
        commits: [commit],
      },
    },
  );
  const newSha = body?.refUpdates?.[0]?.newObjectId;
  if (!newSha) {
    throw new Error(
      `Push to ${refName} did not return a new commit id: ${JSON.stringify(
        body,
      )}`,
    );
  }
  return newSha;
}

async function createBranchAt(repoId, branch, fromSha) {
  const { body } = await ado(
    "POST",
    `${ORG_URL}/${encodeURIComponent(
      PROJECT_NAME,
    )}/_apis/git/repositories/${repoId}/refs?api-version=7.1`,
    {
      body: [
        {
          name: `refs/heads/${branch}`,
          oldObjectId: "0000000000000000000000000000000000000000",
          newObjectId: fromSha,
        },
      ],
    },
  );
  const update = (body?.value ?? [])[0];
  if (!update?.success) {
    throw new Error(
      `Failed to create ref refs/heads/${branch}: ${JSON.stringify(update ?? body)}`,
    );
  }
}

/** Set of file paths (e.g. "/docs/x.md") that already exist on a branch. */
async function getExistingFilePaths(repoId, branch) {
  const { body } = await ado(
    "GET",
    `${ORG_URL}/${encodeURIComponent(
      PROJECT_NAME,
    )}/_apis/git/repositories/${repoId}/items?recursionLevel=Full&versionDescriptor.version=${encodeURIComponent(
      branch,
    )}&versionDescriptor.versionType=branch&api-version=7.1`,
    { allowStatus: [404] },
  );
  const items = body?.value ?? [];
  const set = new Set();
  for (const it of items) {
    if (it.isFolder) continue;
    if (it.path) set.add(it.path);
  }
  return set;
}

// ---------- content from disk ----------

/** Recursively collect absolute file paths under `dir` (empty if missing). */
async function walkFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkFiles(full)));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

function normalizeAdoPath(path) {
  return path.startsWith("/") ? path : `/${path}`;
}

function lfsAttributesChange(paths, existingPaths, changedPaths) {
  if (!paths?.length) return null;
  const attributesPath = "/.gitattributes";
  if (existingPaths.has(attributesPath) || changedPaths.has(attributesPath)) {
    throw new Error(
      "Sandbox lfsPaths cannot update a repository that already defines /.gitattributes",
    );
  }
  const patterns = paths.map((path) => {
    const pattern = normalizeAdoPath(path).slice(1);
    if (!pattern || /[\r\n]/.test(pattern)) {
      throw new Error(`Invalid Git LFS sandbox path: ${path}`);
    }
    return `${pattern.replace(/([\\ \t#])/g, "\\$1")} filter=lfs diff=lfs merge=lfs -text`;
  });
  return {
    changeType: "add",
    item: { path: attributesPath },
    newContent: { content: `${patterns.join("\n")}\n`, contentType: "rawtext" },
  };
}

const FETCH_MANAGED_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

async function sendLfsAction(action, method, body, contentType) {
  const url = new URL(action.href);
  const isAdoHost =
    url.hostname === new URL(ORG_URL).hostname ||
    url.hostname.endsWith(".visualstudio.com");
  url.username = "";
  url.password = "";
  const actionHeaders = Object.fromEntries(
    Object.entries(action.header ?? {}).filter(
      ([name]) => !FETCH_MANAGED_HEADERS.has(name.toLowerCase()),
    ),
  );
  const headers = {
    ...(isAdoHost ? { Authorization: AUTH_HEADER } : {}),
    ...actionHeaders,
    ...(contentType ? { "Content-Type": contentType } : {}),
  };
  let response;
  try {
    response = await fetch(url, { method, headers, body });
  } catch (err) {
    const cause = err instanceof Error ? err.cause : undefined;
    const detail =
      cause && typeof cause === "object"
        ? `${cause.code ?? "network"}: ${cause.message ?? String(cause)}`
        : err instanceof Error
          ? err.message
          : String(err);
    throw new Error(
      `Git LFS ${method} ${url.hostname}${url.pathname} failed (${detail})`,
    );
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Git LFS ${method} ${shortUrl(url.href)} → ${response.status} ${response.statusText}\n  ${detail}`,
    );
  }
}

async function ensureLfsObject(repo, refName, content) {
  const oid = createHash("sha256").update(content).digest("hex");
  const size = content.byteLength;
  const endpoint = `${repo.webUrl.replace(/\/+$/, "")}/info/lfs/objects/batch`;
  const { body } = await ado("POST", endpoint, {
    body: {
      operation: "upload",
      transfers: ["basic"],
      ref: { name: refName },
      objects: [{ oid, size }],
    },
    headers: {
      Accept: "application/vnd.git-lfs+json",
      "Content-Type": "application/vnd.git-lfs+json",
    },
  });
  const object = body?.objects?.[0];
  if (!object || object.error) {
    throw new Error(
      `Git LFS batch rejected ${oid}: ${JSON.stringify(object?.error ?? body)}`,
    );
  }
  if (object.actions?.upload) {
    await sendLfsAction(
      object.actions.upload,
      "PUT",
      content,
      "application/octet-stream",
    );
  }
  if (object.actions?.verify) {
    await sendLfsAction(
      object.actions.verify,
      "POST",
      JSON.stringify({ oid, size }),
      "application/vnd.git-lfs+json",
    );
  }
  return [
    "version https://git-lfs.github.com/spec/v1",
    `oid sha256:${oid}`,
    `size ${size}`,
    "",
  ].join("\n");
}

/**
 * Read every file under `dir` into an ADO `changes[]` array. A path that
 * already exists on the target branch becomes an `edit`; a new path an `add`.
 */
async function readDirAsChanges(dir, existingPaths, options = {}) {
  const files = (await walkFiles(dir)).sort();
  const lfsPaths = new Set(
    (options.lfsPaths ?? []).map((path) => normalizeAdoPath(path)),
  );
  const foundLfsPaths = new Set();
  const changes = [];
  for (const full of files) {
    const adoPath = "/" + relative(dir, full).split(sep).join("/");
    let content;
    if (lfsPaths.has(adoPath)) {
      if (!options.repo || !options.refName) {
        throw new Error(`Git LFS context missing for ${adoPath}`);
      }
      content = await ensureLfsObject(
        options.repo,
        options.refName,
        await readFile(full),
      );
      foundLfsPaths.add(adoPath);
    } else {
      content = await readFile(full, "utf8");
    }
    changes.push({
      changeType: existingPaths.has(adoPath) ? "edit" : "add",
      item: { path: adoPath },
      newContent: { content, contentType: "rawtext" },
    });
  }
  for (const path of lfsPaths) {
    if (!foundLfsPaths.has(path)) {
      throw new Error(`Git LFS sandbox file not found: ${path}`);
    }
  }
  return changes;
}

function readDeleteChanges(paths, existingPaths, changedPaths) {
  return (paths ?? []).map((path) => {
    const adoPath = path.startsWith("/") ? path : `/${path}`;
    if (!existingPaths.has(adoPath)) {
      throw new Error(`Cannot delete missing sandbox file ${adoPath}`);
    }
    if (changedPaths.has(adoPath)) {
      throw new Error(
        `Sandbox PR cannot edit and delete the same file ${adoPath}`,
      );
    }
    return { changeType: "delete", item: { path: adoPath } };
  });
}

// ---------- main commit ----------

async function ensureMain(repo, mainDir) {
  log.step(`Ensuring main commit: ${repo.name}`);
  const head = await getBranchHead(repo.id, "main");
  if (head) {
    log.ok(`main present (head=${short(head)})`);
    return head;
  }
  const changes = await readDirAsChanges(mainDir, new Set());
  if (changes.length === 0) {
    throw new Error(`No files found under ${mainDir}`);
  }
  const sha = await pushCommit(
    repo.id,
    "refs/heads/main",
    "0000000000000000000000000000000000000000",
    { comment: `Seed ${repo.name}`, changes },
  );
  log.ok(`main seeded with ${changes.length} file(s) (head=${short(sha)})`);
  return sha;
}

// ---------- pull requests ----------

async function findPr(repoId, sourceBranch, targetBranch) {
  const { body } = await ado(
    "GET",
    `${ORG_URL}/${encodeURIComponent(
      PROJECT_NAME,
    )}/_apis/git/repositories/${repoId}/pullrequests?searchCriteria.status=all&searchCriteria.sourceRefName=${encodeURIComponent(
      `refs/heads/${sourceBranch}`,
    )}&searchCriteria.targetRefName=${encodeURIComponent(
      `refs/heads/${targetBranch}`,
    )}&api-version=7.1`,
  );
  return (body?.value ?? [])[0] ?? null;
}

async function getPr(repoId, prId) {
  const { body } = await ado(
    "GET",
    `${ORG_URL}/${encodeURIComponent(
      PROJECT_NAME,
    )}/_apis/git/repositories/${repoId}/pullrequests/${prId}?api-version=7.1`,
  );
  return body;
}

const THREAD_STATUS = new Set([
  "active",
  "fixed",
  "wontFix",
  "closed",
  "byDesign",
  "pending",
]);

async function ensurePrAttachments(repoId, prId, attachments) {
  if (!attachments || attachments.length === 0) return new Map();
  const collectionUrl = `${ORG_URL}/${encodeURIComponent(
    PROJECT_NAME,
  )}/_apis/git/repositories/${repoId}/pullrequests/${prId}/attachments`;
  const { body } = await ado("GET", `${collectionUrl}?api-version=7.1`);
  const existing = Array.isArray(body) ? body : (body?.value ?? []);
  const byName = new Map(existing.map((item) => [item.displayName, item]));
  const urls = new Map();

  for (const attachment of attachments) {
    const fileName = attachment.fileName;
    if (!fileName || fileName.includes("/") || fileName.includes("\\")) {
      throw new Error(`Invalid PR attachment fileName: ${fileName}`);
    }
    let item = byName.get(fileName);
    if (!item) {
      const content = await readFile(join(REPO_ROOT, attachment.source));
      const { body: created } = await ado(
        "POST",
        `${collectionUrl}/${encodeURIComponent(fileName)}?api-version=7.1`,
        {
          rawBody: content,
          headers: { "Content-Type": "application/octet-stream" },
        },
      );
      item = created;
      log.ok(`Uploaded PR #${prId} attachment ${fileName}`);
    } else {
      log.ok(`PR #${prId} attachment ${fileName} already exists`);
    }
    const url = item?.url ?? `${collectionUrl}/${encodeURIComponent(fileName)}`;
    urls.set(fileName, url);
  }

  return urls;
}

function expandAttachmentUrls(content, attachmentUrls) {
  return content.replace(/\{\{attachment:([^}]+)\}\}/g, (_match, fileName) => {
    const url = attachmentUrls.get(fileName);
    if (!url) {
      throw new Error(`Comment references undeclared attachment: ${fileName}`);
    }
    return url;
  });
}

/** Seed comment threads on a PR, idempotently (skips if non-system threads exist). */
async function seedThreads(repoId, prId, threads, attachmentUrls = new Map()) {
  if (!threads || threads.length === 0) return 0;
  const { body } = await ado(
    "GET",
    `${ORG_URL}/${encodeURIComponent(
      PROJECT_NAME,
    )}/_apis/git/repositories/${repoId}/pullrequests/${prId}/threads?api-version=7.1`,
  );
  const existing = (body?.value ?? []).filter(
    (t) =>
      !t.isDeleted &&
      (t.comments ?? []).some((c) => c.commentType !== "system"),
  );
  if (existing.length > 0) {
    log.ok(`PR #${prId} already has ${existing.length} thread(s)`);
    return existing.length;
  }
  let created = 0;
  for (const t of threads) {
    const threadBody = {
      comments: [
        {
          parentCommentId: 0,
          content: expandAttachmentUrls(t.comments[0], attachmentUrls),
          commentType: "text",
        },
      ],
      status: THREAD_STATUS.has(t.status) ? t.status : "active",
    };
    if (t.filePath) {
      threadBody.threadContext = {
        filePath: t.filePath,
        rightFileStart: { line: t.rightStartLine ?? 1, offset: 1 },
        rightFileEnd: {
          line: t.rightEndLine ?? t.rightStartLine ?? 1,
          offset: 1,
        },
      };
    }
    const { body: thread } = await ado(
      "POST",
      `${ORG_URL}/${encodeURIComponent(
        PROJECT_NAME,
      )}/_apis/git/repositories/${repoId}/pullrequests/${prId}/threads?api-version=7.1`,
      { body: threadBody },
    );
    // Append any replies as separate comments parented to the root comment.
    const rootId = (thread.comments ?? [])[0]?.id ?? 1;
    for (let i = 1; i < t.comments.length; i++) {
      await ado(
        "POST",
        `${ORG_URL}/${encodeURIComponent(
          PROJECT_NAME,
        )}/_apis/git/repositories/${repoId}/pullrequests/${prId}/threads/${thread.id}/comments?api-version=7.1`,
        {
          body: {
            parentCommentId: rootId,
            content: expandAttachmentUrls(t.comments[i], attachmentUrls),
            commentType: "text",
          },
        },
      );
    }
    created++;
  }
  log.ok(`Seeded ${created} thread(s) on PR #${prId}`);
  return created;
}

/** Wait for ADO to compute a mergeable state, then complete (merge) the PR. */
async function completePr(repo, pr, mergeStrategy) {
  log.info(`Completing PR #${pr.pullRequestId} (${mergeStrategy})…`);
  let current = pr;
  for (let i = 0; i < 30; i++) {
    current = await getPr(repo.id, pr.pullRequestId);
    if (current.status === "completed") {
      log.ok(`PR #${pr.pullRequestId} already completed`);
      return current;
    }
    if (
      current.mergeStatus === "succeeded" &&
      current.lastMergeSourceCommit?.commitId
    ) {
      break;
    }
    if (
      current.mergeStatus === "conflicts" ||
      current.mergeStatus === "failure" ||
      current.mergeStatus === "rejectedByPolicy"
    ) {
      throw new Error(
        `PR #${pr.pullRequestId} is not mergeable (mergeStatus=${current.mergeStatus}).`,
      );
    }
    await sleep(1500);
  }
  if (!current.lastMergeSourceCommit?.commitId) {
    throw new Error(
      `PR #${pr.pullRequestId}: merge commit not ready (mergeStatus=${current.mergeStatus}).`,
    );
  }
  await ado(
    "PATCH",
    `${ORG_URL}/${encodeURIComponent(
      PROJECT_NAME,
    )}/_apis/git/repositories/${repo.id}/pullrequests/${pr.pullRequestId}?api-version=7.1`,
    {
      body: {
        status: "completed",
        lastMergeSourceCommit: {
          commitId: current.lastMergeSourceCommit.commitId,
        },
        completionOptions: {
          deleteSourceBranch: false,
          mergeStrategy,
          bypassPolicy: true,
          bypassReason: "sandbox bootstrap",
        },
      },
    },
  );
  for (let i = 0; i < 30; i++) {
    const after = await getPr(repo.id, pr.pullRequestId);
    if (after.status === "completed") {
      log.ok(`PR #${pr.pullRequestId} completed`);
      return after;
    }
    if (after.status === "abandoned") {
      throw new Error(
        `PR #${pr.pullRequestId} was abandoned during completion.`,
      );
    }
    await sleep(1500);
  }
  log.warn(`PR #${pr.pullRequestId} completion not confirmed in time.`);
  return current;
}

async function ensurePr(repo, repoDir, prSpec, mainHead) {
  const target = "main";
  const { branch } = prSpec;
  log.step(`Ensuring PR: ${branch} → ${target} (${repo.name})`);

  // 1) Branch + overlay commit.
  let head = await getBranchHead(repo.id, branch);
  if (!head) {
    const overlayDir = join(repoDir, "prs", prSpec.overlay);
    const existingPaths = await getExistingFilePaths(repo.id, target);
    const changes = await readDirAsChanges(overlayDir, existingPaths, {
      lfsPaths: prSpec.lfsPaths,
      repo,
      refName: `refs/heads/${target}`,
    });
    const changedPaths = new Set(changes.map((change) => change.item.path));
    const attributesChange = lfsAttributesChange(
      prSpec.lfsPaths,
      existingPaths,
      changedPaths,
    );
    if (attributesChange) {
      changes.push(attributesChange);
      changedPaths.add(attributesChange.item.path);
    }
    changes.push(
      ...readDeleteChanges(prSpec.deletePaths, existingPaths, changedPaths),
    );
    if (changes.length === 0) {
      throw new Error(`No overlay files or deletePaths for ${prSpec.branch}`);
    }
    await createBranchAt(repo.id, branch, mainHead);
    head = await pushCommit(repo.id, `refs/heads/${branch}`, mainHead, {
      comment: prSpec.title,
      changes,
    });
    log.ok(
      `Branch ${branch} pushed (${changes.length} change(s), head=${short(head)})`,
    );

    // Optional: advance the TARGET branch past the fork point. Pushed right
    // after the branch forks, so the merge base stays at the fork while `main`
    // moves ahead — the topology that surfaces the two-dot vs three-dot
    // diff-base bug. Runs only during branch creation, so it's idempotent.
    if (prSpec.advanceTarget) {
      const advanceDir = join(repoDir, prSpec.advanceTarget);
      const advancePaths = await getExistingFilePaths(repo.id, target);
      const advanceChanges = await readDirAsChanges(advanceDir, advancePaths);
      if (advanceChanges.length === 0) {
        throw new Error(`No advanceTarget files under ${advanceDir}`);
      }
      const advanced = await pushCommit(
        repo.id,
        `refs/heads/${target}`,
        mainHead,
        {
          comment: `Advance ${target} past the fork (stale-master repro)`,
          changes: advanceChanges,
        },
      );
      log.ok(
        `Advanced ${target} to ${short(advanced)} (${advanceChanges.length} change(s))`,
      );
    }
  } else {
    log.ok(`Branch ${branch} exists (head=${short(head)})`);
  }

  // 2) Pull request.
  let pr = await findPr(repo.id, branch, target);
  if (!pr) {
    const { body } = await ado(
      "POST",
      `${ORG_URL}/${encodeURIComponent(
        PROJECT_NAME,
      )}/_apis/git/repositories/${repo.id}/pullrequests?api-version=7.1`,
      {
        body: {
          sourceRefName: `refs/heads/${branch}`,
          targetRefName: `refs/heads/${target}`,
          title: prSpec.title,
          description: prSpec.description ?? "",
        },
      },
    );
    pr = body;
    log.ok(`PR opened (#${pr.pullRequestId})`);
  } else {
    log.ok(`PR exists (#${pr.pullRequestId}, status=${pr.status})`);
  }

  // 3) Attachments + threads — seed while the PR is still active so they
  // attach cleanly. Comment bodies can reference uploaded files with
  // `{{attachment:fileName}}` placeholders.
  const attachmentUrls = await ensurePrAttachments(
    repo.id,
    pr.pullRequestId,
    prSpec.attachments,
  );
  await seedThreads(repo.id, pr.pullRequestId, prSpec.threads, attachmentUrls);

  // 4) Completion.
  if (prSpec.complete && pr.status !== "completed") {
    pr = await completePr(repo, pr, prSpec.mergeStrategy ?? "squash");
  }

  return {
    id: pr.pullRequestId,
    title: prSpec.title,
    status: pr.status,
    branch,
    url: `${ORG_URL}/${encodeURIComponent(PROJECT_NAME)}/_git/${encodeURIComponent(
      repo.name,
    )}/pullrequest/${pr.pullRequestId}`,
  };
}

async function ensureRepoFromSpec(project, repoSpec) {
  const repo = await ensureNamedRepo(project.id, repoSpec.name);
  const repoDir = join(SANDBOX_DIR, "repos", repoSpec.name);
  const mainHead = await ensureMain(repo, join(repoDir, "main"));
  const prs = [];
  for (const prSpec of repoSpec.pullRequests ?? []) {
    prs.push(await ensurePr(repo, repoDir, prSpec, mainHead));
  }
  return {
    name: repo.name,
    id: repo.id,
    webUrl: repo.webUrl,
    defaultBranch: repo.defaultBranch,
    mainHead,
    pullRequests: prs,
  };
}

// ---------- utils ----------

function short(sha) {
  return (sha || "").slice(0, 7);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- main ----------

async function main() {
  console.log("Easy Markdown Review — ADO sandbox bootstrap");
  console.log("─".repeat(48));
  log.info(`Org:     ${shortUrl(ORG_URL)}`);
  log.info(`Project: ${PROJECT_NAME}`);
  if (VERIFY_ONLY) log.info("Mode:    verify-only (no mutations)");

  const identity = await verifyConnection();
  if (VERIFY_ONLY) {
    console.log("\n✓ Verification complete. No mutations performed.");
    return;
  }

  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  const repoSpecs = manifest.repos ?? [];
  log.info(`Repos:   ${repoSpecs.length} (from sandbox/manifest.json)`);

  const project = await ensureProject();

  const repos = [];
  for (const repoSpec of repoSpecs) {
    repos.push(await ensureRepoFromSpec(project, repoSpec));
  }

  const completedCount = repos.reduce(
    (n, r) => n + r.pullRequests.filter((p) => p.status === "completed").length,
    0,
  );
  const activeCount = repos.reduce(
    (n, r) => n + r.pullRequests.filter((p) => p.status === "active").length,
    0,
  );

  // Representative completed PR for the backward-compatible top-level fields.
  let primaryRepo = null;
  let primaryPr = null;
  for (const r of repos) {
    const completed = r.pullRequests.find((p) => p.status === "completed");
    if (completed) {
      primaryRepo = r;
      primaryPr = completed;
      break;
    }
  }
  if (!primaryRepo) primaryRepo = repos[0] ?? null;

  const meta = {
    generatedAt: new Date().toISOString(),
    orgUrl: ORG_URL,
    identity,
    project: { id: project.id, name: project.name },
    summary: {
      repos: repos.length,
      completedPullRequests: completedCount,
      activePullRequests: activeCount,
    },
    repos: repos.map((r) => ({
      id: r.id,
      name: r.name,
      webUrl: r.webUrl,
      defaultBranch: r.defaultBranch,
      pullRequests: r.pullRequests,
    })),
    // Backward-compatible single repo/PR fields.
    repo: primaryRepo
      ? {
          id: primaryRepo.id,
          name: primaryRepo.name,
          webUrl: primaryRepo.webUrl,
          defaultBranch: primaryRepo.defaultBranch,
        }
      : null,
    pullRequest: primaryPr ? { id: primaryPr.id, url: primaryPr.url } : null,
  };
  await writeFile(SANDBOX_META_PATH, JSON.stringify(meta, null, 2) + "\n");

  console.log("\n" + "─".repeat(48));
  console.log("✓ Sandbox ready");
  console.log(`  Project:   ${ORG_URL}/${encodeURIComponent(PROJECT_NAME)}`);
  console.log(`  Repos:     ${repos.length}`);
  console.log(
    `  PRs:       ${completedCount} completed, ${activeCount} active`,
  );
  if (primaryPr) console.log(`  Example:   ${primaryPr.url}`);
  console.log(`  Metadata written to .ado-sandbox.json`);
}

main().catch((err) => {
  console.error("\n✘ Setup failed");
  if (err instanceof AdoError) {
    console.error(`  HTTP ${err.status}`);
    console.error(`  ${err.message}`);
    if (err.body && typeof err.body === "object") {
      console.error("  Response body:");
      console.error(
        JSON.stringify(err.body, null, 2)
          .split("\n")
          .map((l) => "    " + l)
          .join("\n"),
      );
    }
  } else {
    console.error(`  ${err.stack || err.message || err}`);
  }
  process.exit(1);
});
