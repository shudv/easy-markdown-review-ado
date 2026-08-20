// Last-visited navigation cache for the Documents hub.
//
// Persists, per project, the repo the user last opened and — per repo — the
// last document they viewed, so a return visit to the bare hub URL reopens
// where they left off.
//
// The whole cache lives under a SINGLE localStorage key as one JSON map
// (`{ [projectId]: { repo, paths: { [repoId]: path } } }`) rather than a key
// per repo/project. localStorage values comfortably hold a full JSON map, and
// one key keeps the namespace tidy and lets us read/replace the structure
// atomically. All access is best-effort: localStorage can throw (private mode,
// quota, disabled storage) and the stored JSON can be corrupt, so every
// accessor swallows errors and degrades to "no memory" rather than surfacing.

/** The single localStorage key holding the entire last-visited map. */
export const LAST_VISITED_KEY = "emr.docs.lastVisited";

/** Per-project last-visited record. */
interface ProjectNav {
  /** Last-visited repo id for the project. */
  repo?: string;
  /** Last-visited document path, keyed by repo id. */
  paths?: Record<string, string>;
}

/** The persisted shape: project id → its last-visited record. */
type NavMap = Record<string, ProjectNav>;

/** Best-effort read + parse of the whole map. Returns `{}` on any failure. */
function readMap(): NavMap {
  try {
    const raw = localStorage.getItem(LAST_VISITED_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as NavMap;
    return {};
  } catch {
    return {};
  }
}

/** Best-effort serialize + persist of the whole map. Silent on failure. */
function writeMap(map: NavMap): void {
  try {
    localStorage.setItem(LAST_VISITED_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/** Best-effort read of the last-visited repo id for a project. */
export function readLastRepo(projectId: string): string | undefined {
  return readMap()[projectId]?.repo;
}

/** Best-effort persist of the last-visited repo id for a project. */
export function writeLastRepo(projectId: string, repoId: string): void {
  const map = readMap();
  const project = map[projectId] ?? {};
  map[projectId] = { ...project, repo: repoId };
  writeMap(map);
}

/** Best-effort read of the last-visited document path for a repo. */
export function readLastPath(
  projectId: string,
  repoId: string,
): string | undefined {
  return readMap()[projectId]?.paths?.[repoId];
}

/** Best-effort persist of the last-visited document path for a repo. */
export function writeLastPath(
  projectId: string,
  repoId: string,
  path: string,
): void {
  const map = readMap();
  const project = map[projectId] ?? {};
  map[projectId] = {
    ...project,
    paths: { ...project.paths, [repoId]: path },
  };
  writeMap(map);
}
