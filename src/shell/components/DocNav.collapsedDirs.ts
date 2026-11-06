// Folder collapse state of the DocNav file tree, persisted per file-list shape.

import { useCallback, useState } from "react";

import { readCollapsedDirs, writeCollapsedDirs } from "./navStorage";
import { pathAncestors } from "./DocNav.model";

/**
 * Expand every ancestor folder of `selectedPath` so the active row stays
 * visible after a navigation; persists (and returns a new set) only on change.
 */
function revealAncestors(
  curr: Set<string>,
  selectedPath: string,
  folderStorageKey: string,
): Set<string> {
  if (!selectedPath) return curr;
  let changed = false;
  const next = new Set(curr);

  for (const dir of pathAncestors(selectedPath)) {
    if (next.has(dir)) {
      next.delete(dir);
      changed = true;
    }
  }

  if (!changed) return curr;
  writeCollapsedDirs(folderStorageKey, next);

  return next;
}

/**
 * Folder paths the user manually collapsed (default: all expanded). Re-read
 * from storage whenever the file list changes shape (`folderStorageKey`), with
 * the selected file's ancestors always revealed — adjusted during render when
 * either input changes.
 */
export function useCollapsedDirs(
  folderStorageKey: string,
  selectedPath: string,
): { collapsedDirs: Set<string>; toggleDir: (dirPath: string) => void } {
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(() =>
    revealAncestors(
      readCollapsedDirs(folderStorageKey),
      selectedPath,
      folderStorageKey,
    ),
  );

  const [source, setSource] = useState({
    folderStorageKey,
    selectedPath,
  });

  if (
    source.folderStorageKey !== folderStorageKey ||
    source.selectedPath !== selectedPath
  ) {
    setSource({ folderStorageKey, selectedPath });

    const base =
      source.folderStorageKey === folderStorageKey
        ? collapsedDirs
        : readCollapsedDirs(folderStorageKey);

    setCollapsedDirs(revealAncestors(base, selectedPath, folderStorageKey));
  }

  const toggleDir = useCallback(
    (dirPath: string) => {
      setCollapsedDirs((curr) => {
        const next = new Set(curr);
        if (next.has(dirPath)) next.delete(dirPath);
        else next.add(dirPath);
        writeCollapsedDirs(folderStorageKey, next);

        return next;
      });
    },
    [folderStorageKey],
  );

  return { collapsedDirs, toggleDir };
}
