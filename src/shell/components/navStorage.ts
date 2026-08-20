// Session-storage persistence for the document navigation rail's collapse
// state. Two independent concerns share this module because both keep DocNav's
// fold state alive across navigation:
//   - Section collapse: per heading-section, also written by ArticleView's
//     in-article toggle so the two stay in sync.
//   - Folder collapse: the set of collapsed directories, keyed by a stable
//     hash of the file list so switching repos starts fresh.

/** Persist a single heading-section's collapsed flag. */
export function persistSectionState(
  storageKey: string,
  sectionId: string,
  collapsed: boolean,
): void {
  try {
    const k = `emr.section.${storageKey}.${sectionId}`;
    if (collapsed) sessionStorage.setItem(k, "1");
    else sessionStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

/** Read a heading-section's collapsed flag (defaults to expanded). */
export function readSectionState(
  storageKey: string,
  sectionId: string,
): boolean {
  try {
    return (
      sessionStorage.getItem(`emr.section.${storageKey}.${sectionId}`) === "1"
    );
  } catch {
    return false;
  }
}

/**
 * Stable per-file-list key for folder collapse state: djb2 over the sorted
 * paths, suffixed with the count to constrain rare collisions. Returning to a
 * repo restores its state; switching repos starts fresh.
 */
export function buildFolderStorageKey(
  files: ReadonlyArray<{ path: string }>,
): string {
  if (files.length === 0) return "empty";
  const paths = files.map((f) => f.path).sort();
  let h = 5381;
  for (const p of paths) {
    for (let i = 0; i < p.length; i += 1) {
      h = ((h << 5) + h + p.charCodeAt(i)) | 0;
    }
  }
  return `${files.length}-${(h >>> 0).toString(36)}`;
}

/** Read the set of collapsed directory paths for a folder storage key. */
export function readCollapsedDirs(key: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(`emr.docnav.collapsedDirs.${key}`);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

/** Persist the set of collapsed directory paths for a folder storage key. */
export function writeCollapsedDirs(key: string, set: Set<string>): void {
  try {
    sessionStorage.setItem(
      `emr.docnav.collapsedDirs.${key}`,
      JSON.stringify(Array.from(set)),
    );
  } catch {
    /* ignore */
  }
}
