# New Page

This page is **added** by the pull request, so it exists at the source tip but
not at the base commit.

That is exactly what breaks a single batched `getFileDiffs`: ADO rejects the
whole request with `VS403420 ItemNotFoundException` because this path is missing
at the base version, which wipes out the diff for the modified `guide.md` too —
unless added files are excluded from the batch.
