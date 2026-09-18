---
title: Assign an issue or pull request to yourself in one click
author: Claude <noreply@anthropic.com>
created: 2026-09-18T09:09:33Z
target: dev
source: fix/xfg8e516-assign-to-self
reviewer: morgan.peyre@brickcode.tech
labels: [enhancement]
assignee: Claude <noreply@anthropic.com>
feature: [web, issues, pull-requests]
revisions:
  - head: c4e76ab545f4f55ab5d157e68557735b9363fda1
    base: 4b70d58db301afa6107a455c326869515151443a
    date: 2026-09-18T09:09:33Z
  - head: f527de45c07d0b2ea6b07176945ca680c5d4c863
    base: 4b70d58db301afa6107a455c326869515151443a
    date: 2026-09-18T10:39:14Z
merged:
  date: 2026-09-18T10:40:15Z
  by: Claude <noreply@anthropic.com>
---

Closes #xfg8e516.

The **Assignees** panel offered one affordance — the pencil — and everything after it was a search: open the menu, type enough of your own name to narrow a directory of everybody, pick yourself, save. Five interactions and a typed substring, every time, for the one value the client already knows.

It now grows a second button beside the pencil that puts the viewer on the list, or takes them off again when they are already on it. One control, not two.

| | Before | After |
|---|---|---|
| Light | ![](.navbook/issues/closed/xfg8e516-assign-an-issue-or-pull-request-to-yourself-in-one/screenshots/before-light.png) | ![](.navbook/issues/closed/xfg8e516-assign-an-issue-or-pull-request-to-yourself-in-one/screenshots/after-light.png) |
| Dark | ![](.navbook/issues/closed/xfg8e516-assign-an-issue-or-pull-request-to-yourself-in-one/screenshots/before-dark.png) | ![](.navbook/issues/closed/xfg8e516-assign-an-issue-or-pull-request-to-yourself-in-one/screenshots/after-dark.png) |

## Which spelling to write

The only hard question here, and worth reviewing closely.

Composing `Name <address>` from the token is the obvious answer and the wrong one: if the `name` claim differs from how git history spells the same address — "M. Peyre" against "Morgan PEYRE" — the file gains a second spelling of one person, and the panel shows both.

So `viewerField` takes the spelling out of `people`, which is the server's own merge of its history, its tree and the viewer, already run through `formatPerson`. It matches on the address lowercased, which is exactly the key core's `dedupePeople` merges on — so this is the client picking among strings the server sent, not the client deciding who is whom. Two different addresses are never one person here.

That keeps the promise `utils/people.ts` opens with, and I amended its header to say what it now does rather than leave the old "decides nothing" reading standing.

Two consequences worth naming:

- The composed fallback is only reachable for an address the answer cannot hold yet, because the `people` resolver merges the viewer in on purpose — its own comment says why: *"somebody who has never committed and whom no file names can still assign the work to themselves."*
- An empty answer yields no button at all rather than one written from a guess. A button offered for the instant before the real answer lands is worse than one that appears a moment late.

Membership is matched the same way, so the toggle still takes you off a list that spells you differently from the menu — the bare address `nav` writes against the named one the token claims.

## Shape

- `utils/people.ts` gains `namesPerson`, `togglePerson` and `viewerField` — pure, and where the tests are. `namesPerson` is the primitive: `togglePerson` filters every entry it decides against, so a list carrying both spellings of one address is cleared whole, and the component asks it directly rather than through a finder.
- `composables/useViewerField.ts` joins the two queries that each hold half the answer. Both are `cache-first` and both are already asked on every page the button appears on, so it costs two cache reads rather than two requests.
- `LabelEditor` gains an optional `self`. It is deliberately generic rather than assignee-specific: the labels read "Add yourself to assignees" from the field's own title, so `reviewer:` could take the same button later without touching the component. The save goes through the existing emit, so a save in flight, a refusal and a stale edit read identically — no new mutation, no new patch shape, no new refresh.
- Both detail pages pass it.

## Verified

- Unit: 367 pass, up from 296.
- End-to-end: the full suite runs 145, all green. Two are new (`test-e2e/self-assign.spec.ts`) and prove the round trip on the issue page and on the pull request page, each under a name held by no fixture and no history — so an assignee bearing it afterwards can only be this button's doing. Each half is read back from a reloaded page: the panel overlays a pending edit, so an assertion taken before the reload would pass whether or not anything reached the file.
- `nuxi typecheck` clean. `biome check` leaves only the three `noVueDuplicateKeys` errors already present on `dev`; this branch adds none.

One trap found while writing those tests, noted in the spec's header: the two pages render the same field differently. The issue page keeps the component's chips, carrying the whole `Name <address>`; the pull request page replaces them with the avatars it already showed, carrying only the name. An assertion on the address passes on one page and fails on the other.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
