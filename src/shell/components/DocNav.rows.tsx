// Recursive DocNav tree rows: folder, file, and heading rows.

import * as React from "react";

import type { FileInfo } from "../../types";
import {
  ChangeIndicatorContext,
  RangeChangesContext,
  fileChangeView,
  type NavNode,
  type DirNavNode,
  basename,
  changeTypeGlyph,
  navNodeKey,
} from "./DocNav.model";
import {
  HeadingTwist,
  HeadingCommentBadge,
  dirTwistText,
  DirTwistButton,
  DirFolderLabel,
  WikiPageLabel,
} from "./DocNav.parts";

// ---------------------------------------------------------------------------
// NavTreeItem — recursive renderer. "file" rows switch the active file (or
// scroll to top) and show change icon, name, diff stats, and a comment badge;
// "heading" rows scroll on click and fold the doc section + nav children via
// the chevron.
// ---------------------------------------------------------------------------

interface NavTreeItemProps {
  node: NavNode;
  depth: number;
  activeId: string | null;
  collapsedIds: Set<string>;
  collapsedDirs: Set<string>;
  /** Folder paths whose lazy-fetch is in flight. */
  loadingDirs: Set<string>;
  selectedPath: string;
  onSelectHeading: (id: string) => void;
  onToggleHeading: (id: string) => void;
  onSelectFile: (path: string) => void;
  onToggleDir: (path: string) => void;
  /** Trigger a lazy fetch of a folder's children. No-op for regular dirs. */
  onExpandLazyDir: (path: string) => void;
}

export function NavTreeItem(props: NavTreeItemProps): React.ReactElement {
  const { node, ...rowProps } = props;

  if (node.kind === "dir") return <DirNavRow {...props} node={node} />;

  if (node.kind === "file") {
    return (
      <FileNavRow
        file={node.file}
        openComments={node.openComments}
        children={node.children}
        {...rowProps}
      />
    );
  }

  return <HeadingNavRow {...props} node={node} />;
}

// ---------------------------------------------------------------------------
// HeadingNavRow — a heading row. The label scrolls to the heading; the chevron
// folds the doc section and the nav children together.
// ---------------------------------------------------------------------------

type HeadingNavNode = Extract<NavNode, { kind: "heading" }>;

function HeadingNavRow(
  props: NavTreeItemProps & { node: HeadingNavNode },
): React.ReactElement {
  const {
    node,
    depth,
    activeId,
    collapsedIds,
    onSelectHeading,
    onToggleHeading,
  } = props;
  const h = node.heading;
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsedIds.has(h.id);
  const isActive = h.id === activeId;
  return (
    <div className="emr-docnav-branch">
      <div
        className={
          "emr-docnav-item" +
          ` lvl-${h.level}` +
          (isActive ? " is-active" : "") +
          (hasChildren ? " has-children" : "")
        }
        data-nav-id={h.id}
        style={
          {
            ["--emr-nav-depth" as keyof React.CSSProperties]: depth,
          } as React.CSSProperties
        }
      >
        {hasChildren ? (
          <HeadingTwist
            collapsed={isCollapsed}
            onToggle={() => onToggleHeading(h.id)}
          />
        ) : (
          <span className="emr-docnav-twist-spacer" aria-hidden />
        )}
        <button
          type="button"
          className="emr-docnav-label"
          onClick={() => onSelectHeading(h.id)}
          title={
            h.openComments > 0
              ? `${h.text} \u2014 ${h.openComments} open comment${h.openComments === 1 ? "" : "s"}`
              : h.text
          }
        >
          <span className="emr-docnav-item-text">{h.text}</span>
          <HeadingCommentBadge heading={h} />
        </button>
      </div>
      {isCollapsed ? null : <NavChildren nodes={node.children} item={props} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DirNavRow — a folder row. The chevron and label expand/collapse it (a lazy
// folder fetches its contents first). A folder that is also a wiki page (its
// `page`, see `mergeWikiPages`) behaves like the wiki's page-with-subpages
// node: the label opens the page — expanding it too — and the chevron alone
// shows or hides the subpages. The open page's outline sits above them and
// stays visible whether or not the subpages are shown (or loaded yet).
// ---------------------------------------------------------------------------

// eslint-disable-next-line max-lines-per-function -- Folder row in the navigation tree: twist button, label, badges and ARIA treeitem attributes for one row.
function DirNavRow(
  props: NavTreeItemProps & { node: DirNavNode },
): React.ReactElement {
  const {
    node,
    depth,
    activeId,
    collapsedDirs,
    loadingDirs,
    selectedPath,
    onSelectFile,
    onToggleDir,
    onExpandLazyDir,
  } = props;
  const page = node.page;
  const isLazy = node.lazy === true;
  const isLoading = loadingDirs.has(node.path);
  // Lazy folders are always "collapsed" until the user triggers a fetch
  // via the chevron or label.
  const isCollapsed = isLazy ? !isLoading : collapsedDirs.has(node.path);
  const onDirToggle = (): void => {
    if (isLazy) onExpandLazyDir(node.path);
    else onToggleDir(node.path);
  };
  const twist = dirTwistText(
    { lazy: isLazy, loading: isLoading, collapsed: isCollapsed },
    page ? "subpages" : "folder",
  );
  const isActivePage = page?.file.path === selectedPath && activeId === null;
  const rowClass = [
    "emr-docnav-item emr-docnav-dir",
    isLoading ? "is-loading" : "",
    page ? "emr-docnav-page" : "",
    isActivePage ? "is-active" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={
        "emr-docnav-branch emr-docnav-dir-branch" + (isLazy ? " is-lazy" : "")
      }
    >
      <div
        className={rowClass}
        style={
          {
            ["--emr-nav-depth" as keyof React.CSSProperties]: depth,
          } as React.CSSProperties
        }
      >
        <DirTwistButton
          twist={twist}
          isCollapsed={isCollapsed}
          isLoading={isLoading}
          onToggle={onDirToggle}
        />
        {page ? (
          <WikiPageLabel
            page={page}
            onOpen={() => {
              onSelectFile(page.file.path);
              if (isCollapsed) onDirToggle();
            }}
          />
        ) : (
          <DirFolderLabel
            node={node}
            isLazy={isLazy}
            isLoading={isLoading}
            isCollapsed={isCollapsed}
            onToggle={onDirToggle}
          />
        )}
      </div>
      <NavChildren
        nodes={node.outline ?? []}
        item={props}
        className="emr-docnav-children emr-docnav-file-children"
      />
      {isCollapsed ? null : <NavChildren nodes={node.children} item={props} />}
    </div>
  );
}

/** A row's nested items, one level deeper; nothing when there are none. */
function NavChildren(props: {
  nodes: readonly NavNode[];
  item: NavTreeItemProps;
  className?: string;
}): React.ReactElement | null {
  const { nodes, item, className = "emr-docnav-children" } = props;
  if (nodes.length === 0) return null;
  return (
    <div className={className}>
      {nodes.map((child) => (
        <NavTreeItem
          key={navNodeKey(child)}
          {...item}
          node={child}
          depth={item.depth + 1}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FileNavRow — top-level file row. Clicking the label switches the active file
// (or scrolls to the top of the current one). The heading-tree children render
// only for the selected file, and the row lights up only when no heading is
// active (single-selection model).
// ---------------------------------------------------------------------------

interface FileNavRowProps extends Omit<NavTreeItemProps, "node"> {
  file: FileInfo;
  openComments: number;
  children: NavNode[];
}

// eslint-disable-next-line max-lines-per-function -- File row in the navigation tree: label, change icon, comment badge, outline toggle and ARIA treeitem attributes for one row.
function FileNavRow(props: FileNavRowProps): React.ReactElement {
  const {
    file,
    openComments,
    children,
    depth,
    activeId,
    collapsedIds,
    collapsedDirs,
    loadingDirs,
    selectedPath,
    onSelectHeading,
    onToggleHeading,
    onSelectFile,
    onToggleDir,
    onExpandLazyDir,
  } = props;
  const showChangeIndicators = React.useContext(ChangeIndicatorContext);
  const change = fileChangeView(file, React.useContext(RangeChangesContext));
  // Single selection: the file row lights up only when no heading is
  // active (user is at the top of the current file). Everything else \u2014
  // "this file is loaded" \u2014 is implicit from which row carries its
  // heading children beneath it.
  const isActive = file.path === selectedPath && activeId === null;
  const fileName = basename(file.path);
  const renamedFromName = file.renamedFrom ? basename(file.renamedFrom) : null;
  const titleText =
    (file.changeType === "renamed" && renamedFromName
      ? `${renamedFromName} \u2192 ${fileName}`
      : file.path) + (change.note ? ` \u2014 ${change.note}` : "");
  return (
    <div className="emr-docnav-branch emr-docnav-file-branch">
      <div
        className={
          "emr-docnav-item emr-docnav-file" +
          (isActive ? " is-active" : "") +
          (change.unchanged ? " is-unchanged-in-range" : "")
        }
        data-change-type={change.changeType}
        style={
          {
            ["--emr-nav-depth" as keyof React.CSSProperties]: depth,
          } as React.CSSProperties
        }
      >
        {/* The change-type icon is the leading affordance and fills the twist
            column. Without it (Documents hub) a spacer holds that column so
            file names line up with sibling folder labels and sit indented
            under their parent. Nested headings indent via `--emr-nav-depth`. */}
        {showChangeIndicators ? null : (
          <span className="emr-docnav-twist-spacer" aria-hidden />
        )}
        <button
          type="button"
          className="emr-docnav-label emr-docnav-file-label"
          onClick={() => onSelectFile(file.path)}
          title={titleText}
        >
          {showChangeIndicators ? (
            <span
              className={"emr-docnav-file-icon is-" + change.changeType}
              aria-hidden
            >
              {changeTypeGlyph(change.changeType)}
            </span>
          ) : null}
          <span className="emr-docnav-file-name">{fileName}</span>
          {change.note ? (
            <span className="emr-sr-only">{` (${change.note})`}</span>
          ) : null}
          {openComments > 0 ? (
            <span
              className="emr-docnav-badge is-open"
              aria-label={`${openComments} open comments`}
            >
              {openComments}
            </span>
          ) : null}
        </button>
      </div>
      {children.length > 0 ? (
        <div className="emr-docnav-children emr-docnav-file-children">
          {children.map((child) => (
            <NavTreeItem
              key={navNodeKey(child)}
              node={child}
              // Headings nested under a file get a single depth bump so
              // they visually indent past the file name without wasting
              // horizontal space. The chevron lands in the file row's
              // "icon column" and the heading text sits just to the
              // right of the file name \u2014 tight but unambiguous
              // hierarchy.
              depth={depth + 1}
              activeId={activeId}
              collapsedIds={collapsedIds}
              collapsedDirs={collapsedDirs}
              loadingDirs={loadingDirs}
              selectedPath={selectedPath}
              onSelectHeading={onSelectHeading}
              onToggleHeading={onToggleHeading}
              onSelectFile={onSelectFile}
              onToggleDir={onToggleDir}
              onExpandLazyDir={onExpandLazyDir}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
