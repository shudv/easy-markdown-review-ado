import type { GitVersionDescriptor } from "azure-devops-extension-api/Git";

import { repositoryImageMimeType } from "../markdown/documentImages";
import {
  isExcalidrawPath,
  renderExcalidrawSvgBlob,
} from "../markdown/excalidraw";
import { fetchRepositoryImageContent } from "./adoRepositoryImages.helpers";
import { withRetry } from "./retry";
import { sharedGitClient } from "./adoClients";

const objectUrls = new Map<string, Promise<string | undefined>>();

export function resolveAdoRepositoryImageObjectUrl(input: {
  repositoryId: string;
  project: string;
  path: string;
  versionDescriptor?: GitVersionDescriptor;
}): Promise<string | undefined> {
  const { repositoryId, project, path, versionDescriptor } = input;
  const key = [
    project,
    repositoryId,
    versionDescriptor?.versionType ?? "",
    versionDescriptor?.version ?? "",
    path,
  ].join("\u0000");
  const cached = objectUrls.get(key);
  if (cached) return cached;

  const pending = (async () => {
    const content = await withRetry(
      () =>
        fetchRepositoryImageContent(sharedGitClient(), {
          repositoryId,
          project,
          path,
          versionDescriptor,
        }),
      {
        mode: "read",
        attempts: 2,
        label: "resolveAdoRepositoryImageObjectUrl.getItemContent",
      },
    );
    const blob = isExcalidrawPath(path)
      ? await renderExcalidrawSvgBlob(content)
      : new Blob([content], { type: repositoryImageMimeType(path) });
    return URL.createObjectURL(blob);
  })();
  // Surface the real failure (status + ADO code) to the reader's telemetry
  // instead of a bare "failed to load", and don't cache it — a transient
  // failure must not keep the image broken for the rest of the session.
  pending.catch(() => objectUrls.delete(key));
  objectUrls.set(key, pending);
  return pending;
}
