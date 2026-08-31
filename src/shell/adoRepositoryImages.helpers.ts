import type {
  GitRestClient,
  GitVersionDescriptor,
} from "azure-devops-extension-api/Git";

export function fetchRepositoryImageContent(
  client: Pick<GitRestClient, "getItemContent">,
  input: {
    repositoryId: string;
    project: string;
    path: string;
    versionDescriptor?: GitVersionDescriptor;
  },
): Promise<ArrayBuffer> {
  return client.getItemContent(
    input.repositoryId,
    input.path,
    input.project,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    input.versionDescriptor,
    true, // includeContent: return the file bytes instead of item metadata.
    true, // resolveLfs: replace an LFS pointer with the stored image bytes.
  );
}
