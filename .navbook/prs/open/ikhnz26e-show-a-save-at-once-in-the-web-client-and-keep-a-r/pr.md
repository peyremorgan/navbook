---
title: Show a save at once in the web client, and keep a refused one beside its field
author: Claude <noreply@anthropic.com>
created: 2026-09-17T21:44:13Z
target: dev
source: fix/fa19dlvj-optimistic-edits
reviewer: morgan.peyre@brickcode.tech
labels: [bug]
feature: web
revisions:
  - head: e9bf19a5b69f0eb9dcf85222800e3f3f9cf1fdf1
    base: 60f829ec46e33f9dda6550870bfe121a4ad53bbf
    date: 2026-09-17T21:44:13Z
  - head: 5c003856cefa47e46ce493b8f9b4dca7dadc96d6
    base: 65ee88db8bdfb13647a9950880d30f54aa430107
    date: 2026-09-17T22:39:08Z
---

Fixes #fa19dlvj: an edit in the web client showed the *old* value until the API answered, with nothing to say a save was out, and a refused save lost what was typed to a toast.

## What changes

**A pending edit is shown from the moment it is sent.** New `usePendingEdits` composable keeps each field's edit while its write is out, and the detail pages render `shown` — the cached entity with every pending edit laid over it — instead of the entity. When the write lands, the payload is already in the normalised cache, so lifting the overlay reveals the same value. On the PR page a reviewer just asked also gets a *Pending* row in the reviewer list, which is otherwise derived on the server.

**A non-blocking "Saving…" that appears only once the wait is long.** `SLOW_SAVE_MS = 1750`: a responsive backend never shows it; a fetch-commit-push that takes seconds does. It is the field's own, not the page's — the shared `busy` flag that made the *comment* button spin during an assignee save is replaced by per-write `loading` refs on `useIssueMutations`.

**Any refusal is kept beside the field, with Retry and Discard.** New `SaveStatus` component under `LabelEditor`, `EditableText` and `FieldEditor` shows the server's heading and sentence, keeps the attempted value on the page, and offers to send it again through the page's own `save` (so a Retry rebuilds the patch against the current `baseSha`) or to drop it. The shared error toast is told to stay quiet for `updateIssue`, `updatePr` and `updateFeature` (`context: { handled: true }`) so nothing is said twice. `STALE_CONTENT` keeps its existing `useStaleEdit` alert on the issue and PR pages; on the feature page it becomes an inline refusal after a refetch, so Retry is "save mine over theirs".

**The rest of the audit.**
- Inbox reorder: a refused drop stays where it landed with the same Retry/Discard line under the list, instead of springing back with only a screen-reader announcement.
- Close-issue dialog: stays open on a refusal instead of closing and clearing the resolution that was typed.
- Unlink subtask: the row is hidden at once and stays hidden until the tree has been read again; a refusal brings it back.

## Tests

- `test/nuxt/pending-edits.test.ts`: overlay while in flight and lifted on landing; slow only after 1750 ms and never for an answered save; refusal kept with heading and message; transport failure; retry through `resend`; discard; handled-elsewhere lifts the overlay; a newer save of the same field supersedes an older answer; independent fields.
- `test-e2e/saving-feedback.spec.ts`: holds or refuses the one mutation at the network edge with `page.route`, against the real stack. Proves the chip is shown at once, no indicator before 800 ms and one afterwards, no spinner on the comment button, the inline refusal with Retry and Discard on the issue page, the pending reviewer row on the PR page, and the refused inbox drop.
- Full web suite: 341 unit tests and the whole end-to-end suite green (see the comment for the run).

`packages/web/README.md` says what a save shows now.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
