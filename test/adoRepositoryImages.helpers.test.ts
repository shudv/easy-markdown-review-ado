import type { GitRestClient } from "azure-devops-extension-api/Git";
import { describe, expect, it, vi } from "vitest";

import { fetchRepositoryImageContent } from "../src/shell/adoRepositoryImages.helpers";

describe("fetchRepositoryImageContent", () => {
  it("requests the resolved LFS content at the supplied version", async () => {
    const content = new ArrayBuffer(4);
    const getItemContent = vi.fn().mockResolvedValue(content);
    const client = { getItemContent } as Pick<GitRestClient, "getItemContent">;
    const versionDescriptor = {
      version: "target-commit",
      versionType: 2,
      versionOptions: 0,
    };

    await expect(
      fetchRepositoryImageContent(client, {
        repositoryId: "repo-id",
        project: "project-id",
        path: "/docs/image.png",
        versionDescriptor,
      }),
    ).resolves.toBe(content);
    expect(getItemContent).toHaveBeenCalledWith(
      "repo-id",
      "/docs/image.png",
      "project-id",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      versionDescriptor,
      true,
      true,
    );
  });
});
