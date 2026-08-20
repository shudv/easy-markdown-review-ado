# Security policy

## Reporting a vulnerability

If you believe you've found a security vulnerability in Easy Markdown Review, **please do not file a public issue or pull request**. Instead, email the maintainers directly so we can investigate and ship a fix before the details become public.

Send the report to: **shubd3@gmail.com**

Please include, where possible:

- A description of the issue and the impact you believe it could have.
- The version (or commit hash) of the extension you observed it in.
- A reproduction — a minimal markdown file, a screenshot, or step-by-step instructions.
- Whether the issue requires a malicious actor to already have some level of access (e.g. PR-comment author, repo write).

You can expect:

- An acknowledgement within **3 business days**.
- A triage decision (accept / decline / need-more-info) within **10 business days**.
- If accepted, a target fix-or-mitigation timeline based on severity:
  - **Critical** (unauthenticated remote code execution, persistent XSS reaching the host): 7 days.
  - **High** (authenticated XSS, privilege escalation): 30 days.
  - **Medium / Low**: bundled into the next routine release.

We'll coordinate disclosure with you and credit you in the release notes unless you request otherwise.

## What's in scope

- The packaged extension code under `src/`.
- The build, package, and publish scripts under `scripts/`.
- The pipeline definitions under `.azure-pipelines/`.
- The dependency closure declared in `package.json` / `package-lock.json`.

## What's out of scope

- Vulnerabilities in the Azure DevOps host application or the Visual Studio Marketplace itself — report those to Microsoft via [https://msrc.microsoft.com](https://msrc.microsoft.com).
- Vulnerabilities in upstream npm dependencies — please file with the upstream maintainer; we will pick up the fix once it ships.
- Issues that require the attacker to already have admin-level access in the consuming ADO organization (e.g. "an admin who can install extensions can install a compromised one"). That's a property of the platform, not this extension.
- Browser-specific UI rendering quirks that are not exploitable.

## Threat model

A full STRIDE-style threat model lives at [docs/threat-model.md](docs/threat-model.md). Read that first if you're trying to understand the trust boundaries before reporting.
