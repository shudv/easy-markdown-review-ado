// Pure error-shape extraction shared by the telemetry sinks.
//
// Pulls the diagnostically useful, PRIVACY-SAFE fields out of the many error
// shapes the app sees — a plain `Error`, an ADO `TFS.WebApi.Exception` (which
// carries `.status` / `.responseText`), or a bare `{ status }` object — so every
// exception in the backend carries the HTTP status and the ADO error code, not
// just a message + stack. Before this, a `TF400813` landed in Kusto with an
// empty status and we couldn't tell 401 (session/expiry) from 403 (authorization)
// without a live repro.
//
// Deliberately does NOT surface raw `responseText`: it can contain the failing
// user's identity GUID. Only the structured `TF######` code is extracted.

export interface ErrorShape {
  message: string;
  name?: string;
  stack?: string;
  /** HTTP status when the error carries one (401 / 403 / 500 …). */
  httpStatus?: number;
  /** ADO error code, e.g. "TF400813", when present in the message / responseText. */
  adoErrorCode?: string;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Best-effort HTTP status across `status` / `statusCode` / nested `serverError`. */
export function httpStatusOf(error: unknown): number | undefined {
  const e = asObject(error);
  if (!e) return undefined;
  for (const c of [e.status, e.statusCode, e.httpStatusCode]) {
    if (typeof c === "number" && c >= 100 && c <= 599) return c;
  }
  const se = asObject(e.serverError);
  if (se && typeof se.status === "number") return se.status;
  return undefined;
}

// ADO surfaces server errors as `TF######` codes (e.g. TF400813). Match those
// so we can slice failure modes in the backend without any identifying text.
const ADO_CODE_RE = /\bTF\d{5,6}\b/;

/** Extract the ADO `TF######` error code from the error's text, if any. */
export function adoErrorCodeOf(error: unknown): string | undefined {
  const texts: string[] = [];
  if (error instanceof Error && error.message) texts.push(error.message);
  const e = asObject(error);
  if (e) {
    if (typeof e.responseText === "string") texts.push(e.responseText);
    const se = asObject(e.serverError);
    if (se) {
      if (typeof se.message === "string") texts.push(se.message);
      if (typeof se.typeKey === "string") texts.push(se.typeKey);
    }
  }
  for (const t of texts) {
    const m = ADO_CODE_RE.exec(t);
    if (m) return m[0];
  }
  return undefined;
}

/** A readable message that never degrades to `"[object Object]"`. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  const e = asObject(error);
  if (e) {
    if (typeof e.message === "string") return e.message;
    try {
      // Serialize for diagnosability, but strip `responseText`: an ADO error's
      // raw HTTP body can carry the failing user's identity GUID, and the
      // telemetry redactor doesn't scrub GUIDs. (PR AI review, security.)
      const json = JSON.stringify(error, (key, value) =>
        key === "responseText" ? undefined : (value as unknown),
      );
      if (json && json !== "{}") return json;
    } catch {
      /* circular / BigInt — fall through */
    }
    return Object.prototype.toString.call(error);
  }
  return String(error as string | number | boolean | null | undefined);
}

/** Extract the message, name, stack, HTTP status, and ADO code from any thrown value. */
export function describeError(error: unknown): ErrorShape {
  const shape: ErrorShape = { message: messageOf(error) };
  if (error instanceof Error) {
    if (error.name) shape.name = error.name;
    if (error.stack) shape.stack = error.stack;
  }
  const status = httpStatusOf(error);
  if (status !== undefined) shape.httpStatus = status;
  const code = adoErrorCodeOf(error);
  if (code !== undefined) shape.adoErrorCode = code;
  return shape;
}
