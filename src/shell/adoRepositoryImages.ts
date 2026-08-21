import { getClient } from "azure-devops-extension-api";
import {
  GitRestClient,
  type GitVersionDescriptor,
} from "azure-devops-extension-api/Git";

import { repositoryImageMimeType } from "../markdown/documentImages";
import { fetchRepositoryImageContent } from "./adoRepositoryImages.helpers";
import { withRetry } from "./retry";

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
    try {
      const content = await withRetry(
        () =>
          fetchRepositoryImageContent(getClient(GitRestClient), {
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
      const blob = new Blob([content], { type: repositoryImageMimeType(path) });
      return URL.createObjectURL(blob);
    } catch {
      return undefined;
    }
  })();
  objectUrls.set(key, pending);
  return pending;
}
