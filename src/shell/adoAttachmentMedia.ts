import * as SDK from "azure-devops-extension-sdk";

import { withRetry } from "./retry";

const objectUrls = new Map<string, Promise<string | undefined>>();

export function resolveAdoAttachmentObjectUrl(
  url: string,
): Promise<string | undefined> {
  const cached = objectUrls.get(url);
  if (cached) return cached;

  const pending = (async () => {
    try {
      const response = await withRetry(
        async () => {
          const token = await SDK.getAccessToken();
          const result = await fetch(url, {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "image/*",
            },
          });
          if (!result.ok) {
            throw Object.assign(
              new Error(`comment attachment HTTP ${result.status}`),
              { status: result.status, headers: result.headers },
            );
          }
          return result;
        },
        {
          mode: "read",
          attempts: 2,
          label: "resolveAdoAttachmentObjectUrl.fetch",
        },
      );
      return URL.createObjectURL(await response.blob());
    } catch {
      return undefined;
    }
  })();
  objectUrls.set(url, pending);
  return pending;
}
