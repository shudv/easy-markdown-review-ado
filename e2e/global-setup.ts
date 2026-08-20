// Global setup for the e2e suite — enforces that the dev bundles ADO will load
// are being served by the STRICT "verification" dev server (`npm run dev:verify`),
// not the plain HMR loop (`npm run dev:https`).
//
// Why gate on this: e2e is the only stage that runs the real, un-mocked app
// inside a real cross-origin ADO iframe. Running it under the same
// production-representative CSP the ADO host imposes (no inline <script>, no
// eval, locked object-src/base-uri) means the suite exercises maximal coverage
// of the shipped security posture — an inline-script/eval regression fails the
// e2e run instead of only surfacing once published. If the strict server isn't
// up, we fail fast here with an actionable message rather than letting specs
// run against a non-representative server.

import { get } from "node:https";
import { E2E } from "./env";

/** Fetch response headers for a dev-origin URL, tolerating the self-signed cert. */
function headOf(
  url: string,
): Promise<{ status: number; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const req = get(url, { rejectUnauthorized: false }, (res) => {
      // Drain so the socket can close; we only need status + headers.
      res.resume();
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) {
        headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : (v ?? "");
      }
      resolve({ status: res.statusCode ?? 0, headers });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("timeout")));
  });
}

export default async function globalSetup(): Promise<void> {
  const url = `${E2E.devOrigin}/pr-tab/pr-tab.html`;

  let res: { status: number; headers: Record<string, string> };
  try {
    res = await headOf(url);
  } catch (err) {
    throw new Error(
      `e2e: could not reach the dev server at ${E2E.devOrigin} (${
        (err as Error).message
      }).\n` +
        "Start the STRICT verification server first, in a separate terminal:\n" +
        "  npm run dev:verify\n" +
        "(e2e enforces the strict server so it runs under the same CSP the ADO host imposes.)",
    );
  }

  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `e2e: dev server at ${E2E.devOrigin} responded with HTTP ${res.status} for ${url}.\n` +
        "The e2e suite requires this page to be available before validating CSP headers.\n" +
        "Start (or restart) the STRICT verification server:\n" +
        "  npm run dev:verify",
    );
  }

  const csp = res.headers["content-security-policy"] ?? "";
  const nosniff = res.headers["x-content-type-options"] ?? "";

  // The strict server sets a script-src that forbids inline + eval. The plain
  // `dev:https` loop sends no CSP at all, so an empty/missing header is the
  // tell-tale that the wrong server is running.
  const scriptSrc = /(?:^|;)\s*script-src\s+([^;]+)/i.exec(csp)?.[1] ?? "";
  const scriptAllowsSelfOnly =
    /'self'/.test(scriptSrc) &&
    !/'unsafe-inline'/.test(scriptSrc) &&
    !/'unsafe-eval'/.test(scriptSrc);

  if (!csp || !scriptAllowsSelfOnly) {
    throw new Error(
      "e2e: the dev server is not running in STRICT verification mode.\n" +
        `  expected a Content-Security-Policy with "script-src 'self'" (no inline/eval) at ${url}\n` +
        `  got: ${csp ? `Content-Security-Policy: ${csp}` : "no Content-Security-Policy header"}\n` +
        "Restart the dev server in strict mode (it mirrors the ADO host CSP):\n" +
        "  npm run dev:verify\n" +
        "(plain `npm run dev:https` is not accepted for e2e — it doesn't enforce the production security posture.)",
    );
  }

  if (!/nosniff/i.test(nosniff)) {
    throw new Error(
      `e2e: dev server is missing "X-Content-Type-Options: nosniff" at ${url}. ` +
        "Ensure you started it with `npm run dev:verify`.",
    );
  }

  console.log(
    `e2e: verified strict dev server at ${E2E.devOrigin} (CSP enforced, nosniff on).`,
  );
}
