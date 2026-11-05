// Small avatar: the user's photo when available, falling back to initials on a
// deterministic background hue keyed off the user id (so the same person looks
// the same everywhere) — and also when no photo resolves or it fails to load.
//
// ADO identity image URLs live on the ADO host and require auth. Loaded as a
// bare <img> from the localhost extension iframe they're an unauthenticated
// cross-site request and fail, so the real hosts inject an `AvatarImageContext`
// resolver that fetches the photo with the SDK token and returns a local blob
// URL. With no resolver (Storybook / standalone / data URLs) the avatarUrl is
// used directly.

import * as React from "react";
import type { CommentAuthor } from "../../types";

/** Resolves an ADO avatar URL to a directly-renderable URL (e.g. a blob URL). */
export type AvatarImageResolver = (url: string) => Promise<string | undefined>;

export const AvatarImageContext = React.createContext<
  AvatarImageResolver | undefined
>(undefined);

interface AvatarProps {
  author: CommentAuthor;
  size?: "sm" | "md";
}

const HUES = [210, 0, 160, 280, 30, 195, 340, 100, 250, 50];

function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length]!;
}

export function Avatar({
  author,
  size = "md",
}: Readonly<AvatarProps>): React.ReactElement {
  const resolveImage = React.useContext(AvatarImageContext);
  const { avatarUrl } = author;
  const hasUrl = avatarUrl !== undefined && avatarUrl !== "";
  // No resolver: render the URL directly (Storybook / standalone / data URL).
  const directSrc = hasUrl && !resolveImage ? avatarUrl : undefined;
  const [resolvedSrc, setResolvedSrc] = React.useState<string | undefined>(
    directSrc,
  );
  // Fall back to initials if the resolved photo fails to load.
  const [photoFailed, setPhotoFailed] = React.useState(false);
  // A new photo source resets the failure and adopts the direct URL (or clears
  // it) right away; a resolver's local URL arrives asynchronously below.
  const [source, setSource] = React.useState({ avatarUrl, resolveImage });
  if (source.avatarUrl !== avatarUrl || source.resolveImage !== resolveImage) {
    setSource({ avatarUrl, resolveImage });
    setPhotoFailed(false);
    if (!hasUrl || !resolveImage) setResolvedSrc(directSrc);
  }

  React.useEffect(() => {
    if (!hasUrl || !resolveImage) return;
    // Real host: fetch the photo with auth and adopt the local URL it returns.
    let cancelled = false;
    void resolveImage(avatarUrl).then((url) => {
      if (cancelled) return;
      setResolvedSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [avatarUrl, hasUrl, resolveImage]);

  const hue = hueFor(author.id);
  const bg = `hsl(${hue}, 55%, 42%)`;
  const cls = size === "sm" ? "emr-avatar sz-sm" : "emr-avatar";
  const showPhoto = Boolean(resolvedSrc) && !photoFailed;
  return (
    <span className={cls} style={{ background: bg }} title={author.displayName}>
      {showPhoto ? (
        <img
          className="emr-avatar-img"
          src={resolvedSrc}
          alt=""
          onError={() => setPhotoFailed(true)}
        />
      ) : (
        author.initials
      )}
    </span>
  );
}
