---
title: Assign an issue or pull request to yourself in one click
author: Claude <noreply@anthropic.com>
created: 2026-09-18T08:54:41Z
labels: [enhancement]
assignee: Claude <noreply@anthropic.com>
feature: [web, issues, pull-requests]
---

Assigning an issue or a pull request to yourself in the web client costs exactly as much as assigning it to a stranger. The Assignees panel offers one control — a pencil — and everything after it is a search through everyone the repository has ever known.

## Repro

1. `pnpm --filter @navbook/web dev:stack`, open <http://localhost:3000>, sign in as anybody.
2. Open any issue or pull request.
3. Assign it to yourself.

What you have to do for step 3:

1. click the pencil beside **Assignees** (`edit-assignees`)
2. click the select to open it
3. type enough of your own name or address to narrow the menu
4. click your own entry
5. click **Save** (`save-assignees`)

Five interactions and a typed substring, every time, for the single value the client already knows. Unassigning yourself is the same five with a deselect in the middle.

## Where it is

Both detail pages render the field through the same component, with the same suggestion list:

- [`pages/issues/[ref].vue:376-385`](packages/web/app/pages/issues/[ref].vue#L376-L385)
- [`pages/prs/[ref].vue:443-452`](packages/web/app/pages/prs/[ref].vue#L443-L452)

`LabelEditor` has exactly one affordance in its header, the pencil that opens the draft ([`components/LabelEditor.vue:84-93`](packages/web/app/components/LabelEditor.vue#L84-L93)), and the editing half is a `CreatableSelect` over `suggestions` — for this field, `usePeople()`, i.e. everybody ([`components/CreatableSelect.vue`](packages/web/app/components/CreatableSelect.vue)).

Nothing anywhere offers a shortcut: grepping the client for a self-assign finds only the inbox's read-only *"Assigned to me"* scope ([`components/InboxRail.vue:35`](packages/web/app/components/InboxRail.vue#L35)) and the `assignees: [$me]` filters behind it ([`graphql/queries.ts:133-151`](packages/web/app/graphql/queries.ts#L133-L151)). The client can say *show me my work*; it cannot say *make this mine*.

## Everything the fix needs already exists

- **Who the viewer is.** `VIEWER_QUERY` asks for `name` and `email` ([`graphql/queries.ts:21-29`](packages/web/app/graphql/queries.ts#L21-L29)), resolved from the token at [`packages/server/src/resolvers/query.ts:89`](packages/server/src/resolvers/query.ts#L89). `useInbox` already reads it, `cache-first`, so a second consumer costs a cache read rather than a request ([`composables/useInbox.ts:33-38`](packages/web/app/composables/useInbox.ts#L33-L38)).
- **The exact string to write.** The `people` resolver merges the viewer in as a third source and formats the whole list through `formatPerson` ([`query.ts:120-127`](packages/server/src/resolvers/query.ts#L120-L127)). Its own comment says why: *"somebody who has never committed and whom no file names can still assign the work to themselves."* The suggestion list is already spelled the way the file wants it.
- **The save path.** `save({ assignees })` and the pending-edit overlay are what the pencil flow already uses; a button emitting the same payload needs no new mutation, no new patch shape and no new refresh.

## Constraint worth getting right: which spelling

An assignee is free text (spec 06 §6.6), and `formatPerson` renders `Name <email>` or a bare `email` ([`packages/core/src/core/person.ts:30-32`](packages/core/src/core/person.ts#L30-L32)). Composing `` `${viewer.name} <${viewer.email}>` `` from the token is the obvious move and the wrong one: if the token's `name` claim differs from how git history spells the same person ("M. Peyre" vs "Morgan PEYRE"), the file gains a second distinct assignee string for one human, and the panel shows both.

So the button should resolve its value out of `people` — the entry whose address matches the viewer's `email` — and only compose from the viewer when `people` has no such entry. The server guarantees one of the two is always true.

`useInbox`'s header states the related rule and applies here too: the address to match on is the server's reading of the token, not the claim this client parsed out of its own copy ([`composables/useInbox.ts:1-13`](packages/web/app/composables/useInbox.ts#L1-L13)).

## What is wanted

In the **Assignees** header of both detail pages, beside the pencil, a button that assigns the viewer in one click — and, when the viewer is already assigned, removes them, so the same control undoes itself. It writes through the existing `save({ assignees })`, so a save in flight, a refusal and a stale-edit alert all read exactly as they do for the pencil.

The listing rows are out of scope: the ask is about the page you are already reading when you decide the work is yours.
