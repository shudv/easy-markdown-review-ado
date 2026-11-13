// Validates the build-time telemetry credentials without loading either SDK,
// so a misconfigured build is reported (and stays off) before any chunk loads.

/**
 * The ingestion endpoint of an Application Insights connection string
 * (`InstrumentationKey=…;IngestionEndpoint=https://…/;…`), or null when it has
 * no instrumentation key or the endpoint isn't https.
 */
export function parseConnectionString(raw: string): { ingestionEndpoint: string } | null {
    const fields = new Map<string, string>();

    for (const part of raw.split(";")) {
        const eq = part.indexOf("=");
        if (eq > 0) fields.set(part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim());
    }

    const endpoint = fields.get("ingestionendpoint") ?? "https://dc.services.visualstudio.com";

    if ((fields.get("instrumentationkey") ?? "") === "" || !endpoint.startsWith("https://")) {
        return null;
    }

    return { ingestionEndpoint: endpoint.replace(/\/+$/, "") };
}

/** True for a usable Sentry DSN (`https://<key>@<host>/<project>`). */
export function isUsableDsn(dsn: string): boolean {
    try {
        const url = new URL(dsn);

        return url.protocol === "https:" && url.username !== "" && /\/\d+$/.test(url.pathname);
    } catch {
        return false;
    }
}
