---
title: Detect a concurrent edit to the same field of an issue or pull request, instead of last-write-wins
author: Morgan PEYRE <morgan@peyre.info>
created: 2026-09-16T06:10:21Z
labels: [enhancement]
assignee: Claude <noreply@anthropic.com>
feature: [server, web, issues]
parent: tn7ptt6k
---

`updateSpec` and `updateFeature` take the `baseSha` the editor started from and refuse with `STALE_CONTENT` when the file has moved on since. `updateIssue` and `updatePr` take no such thing: `patchEntity` in `src/resolvers/mutation.ts` reads the file, applies the patch and writes it back, with nothing to say what the client was looking at when it composed the request.

Most of the time this is fine, and it is worth being precise about why. The patch is field-scoped and the file is re-read inside the lock after the pull, so two people changing *different* fields do not clobber each other — the second patch lands on the first one's file and both changes survive. The gap is the same field twice: A retitles an issue, B retitles it from a page rendered before A's change, and B's title wins silently. Neither is told, and the only record that A's title ever existed is the commit history nobody is reading at that moment.

That is the same hazard `updateSpec` already refuses, and the reasoning the server README gives for specs applies here in miniature: landing a save on top of somebody else's words is exactly the conflict this server surfaces rather than resolves. It is only weaker for issues because the unit is a field rather than a document.

## What it should do

Extend the mechanism that already exists rather than inventing a second one.

1. **`baseSha` on `Issue` and `Pr`**, the blob hash of `issue.md` or `pr.md` as it now stands, documented as `Feature.baseSha` is.
2. **An optional `baseSha` on `UpdateIssueInput` and `UpdatePrInput`.** Optional, not required, and that is the one place this departs from `updateSpec`: a client that wants to set one field without having read the whole entity — a listing that toggles a label, a drag that sets a rank — should not have to fetch the file first. Absent means today's behaviour; present and stale means `STALE_CONTENT`, with the same payload shape the spec editor already handles.
3. **Compare per field, not per file.** A stale `baseSha` should only refuse when the patch touches a key that actually changed since. B setting a label on an issue A retitled is not a conflict with anybody, and refusing it would teach clients to stop sending `baseSha` — which would undo the ticket. The refusal names the keys that moved.
4. **The web client sends it** wherever it edits a field in place from a rendered value, and shows the refusal the way `SpecEditor.vue` does: say the file moved on, show what it says now, let the person reapply. `app/utils/errors.ts` already maps `STALE_CONTENT`.

## Edges

- `Comment` is append-only and needs none of this; so do `closeIssue`, `reopenIssue`, `linkIssue` and `unlinkIssue`, which are state transitions whose own preconditions already catch a repeat.
- The hash is of the file, so it changes when a comment count does not — comments live in their own files, which is what makes per-file hashing usable here at all.
- Per-field comparison needs the previous version of the file, which is `git show <baseSha>` in the clone. That blob is reachable as long as the sha came from this server; a sha from a clone this one has not fetched is not resolvable, and should be refused as stale rather than crashed on.
- The README's "two clients editing one issue are last-write-wins rather than detected" comes out when this lands, and the sentence about what the server does and does not resolve should absorb it.
