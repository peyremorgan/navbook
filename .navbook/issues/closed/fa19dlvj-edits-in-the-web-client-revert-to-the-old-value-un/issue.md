---
title: Edits in the web client revert to the old value until the API answers, with no saving indicator or retry
author: Claude <noreply@anthropic.com>
created: 2026-09-17T21:24:13Z
labels: [bug]
assignee: Claude <noreply@anthropic.com>
feature: web
resolution: fixed
---

Editing the assignees of an issue or pull request in the web client gives no visual feedback between clicking Save and the API answering. The editor closes at once and the sidebar goes back to showing the *old* list of assignees, as if the edit had been discarded; the new list appears only when the mutation's response lands. On a fast local stack that gap is about half a second, but every write is a fetch, a commit and a push to the remote, serialised behind the server's mutex, so on a deployed tracker it is routinely seconds, and it reads as "my change was thrown away".

The same shape is present on most of the in-place editors, not just the assignee menu — see the audit in the comments.

## Expected

- **Optimistic state.** The moment Save is clicked the control shows what was saved, and keeps showing it until the server either confirms it or refuses it.
- **A non-blocking "saving" indicator** on the control that was edited, held invisible for the first ~1750 ms so that a responsive backend never flashes it.
- **On failure, an inline error with Retry and Discard.** What was typed is the only copy of itself; today it is lost, and the only trace is a toast.

## Actual

- The read-only view is bound straight to the cached entity, and the editor closes on Save, so the old value is displayed for the whole round trip.
- The only "saving" indicator is the `loading` state on the Save button, which is unmounted by the time it would be true.
- On failure the shared error link toasts the server's message and the mutation resolves to `null`; the draft is gone, and there is nothing to retry or discard. The one exception is a `STALE_CONTENT` refusal, which `useStaleEdit` keeps and offers to reapply.
- Every editor on a page shares one `busy` flag, so while an assignee save is in flight the spinner that *does* appear is on the comment button.
