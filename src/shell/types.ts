// Stable types for the Documents hub.
//
// Lives outside `dev/fixtures/` so production code can import these shapes
// without dragging the markdown-source side-effect imports of the fixture
// module into the prod bundle.

import type { FileInfo } from "../types";

export interface DocRepo {
  /** Internal id (ADO repository id, or a synthetic id for fixtures). */
  id: string;
  /** Display name. */
  name: string;
  /** Short human description shown under the repo name in the picker. */
  description: string;
  /** Default branch we read docs from. */
  defaultBranch: string;
  /**
   * The set of `.md` files currently known to the UI. In lazy mode this
   * is just the root-level files; deeper files are appended as the user
   * expands folders. In fully-loaded mode (e.g. standalone fixtures or
   * post-search) this is everything we have discovered so far.
   */
  files: FileInfo[];
  /**
   * Folder paths known to exist (because we saw them in a OneLevel
   * listing) but whose contents we haven't fetched yet. The DocNav
   * renders these as expandable rows; expanding triggers an
   * `onExpandFolder` call. Empty (or omitted) in fully-loaded mode.
   */
  topLevelFolders?: string[];
  /**
   * Most recent completed PR that targets `defaultBranch`. When
   * present the Documents view routes new comments there and the rail
   * shows a routed-PR pill; when absent the view disables commenting
   * with a read-only banner.
   */
  recentPr: {
    id: number;
    title: string;
    author: string;
    /** Active = open / Completed = merged. Drives the pill colour. */
    status: "active" | "completed";
    /** Optional web URL pointing to the PR overview page in ADO. */
    url?: string;
  } | null;
  /**
   * `false` while a deferred per-repo PR-routing fetch is still
   * pending; `true` (or omitted, for back-compat with fixtures /
   * tests / the eager `discoverDocRepos` path) once `recentPr` has
   * been resolved. The Documents shell uses this to delay the
   * threads load (and the PrShell mount) until routing is known
   * — otherwise the initial render would show LocalOnly threads
   * which a subsequent re-render couldn't correct because PrShell
   * consumes `initialThreads` once at mount.
   */
  detailsLoaded?: boolean;
  /**
   * Per-document ("transparent PR") commenting permission. `false` only when
   * ADO explicitly denied Contribute on the repo (commenting needs to push a
   * branch + open a draft PR); `undefined` / `true` leave commenting enabled
   * (optimistic — an unresolved or unsupported probe never locks contributors
   * out). Resolved lazily alongside PR routing.
   */
  canComment?: boolean;
}

/**
 * Result of a one-level folder listing. `files` are the immediate `.md`
 * files inside the requested path; `folders` are the immediate
 * subfolder paths (so the DocNav knows what to render as expandable).
 */
export interface FolderListing {
  files: FileInfo[];
  folders: string[];
}
