---
title: "plugin-poll: polls in the web client"
author: Claude <noreply@anthropic.com>
created: 2026-10-05T03:06:49Z
target: dev
source: feat/gel4fvdo-plugin-poll-web
reviewer: morgan.peyre@brickcode.tech
revisions:
  - head: 66a491d4e5f26d363bc9316640b4d4c87b17df99
    base: 11b41b1019658234ecfe1dd553da3d52c7fc14d3
    date: 2026-10-05T03:06:49Z
  - head: 51e29edb1355b7cf7b942ccd43002ac278e82c69
    base: 51578e067f6288ced846d27d52586f704a3ba41a
    date: 2026-10-13T23:34:29Z
---

The last of three pull requests for #gel4fvdo: polls in the web client. It is stacked on #nh75ce1c (the API), itself on #p4jj02ne (the format, the core and `nav poll`), and carries their commits until they merge; review the commits from `feat(web): two slots` on. It closes the issue.

## Two host seams (`packages/web`)

- **`timelineItems`**: a layer places what happened on an issue in its discussion. It reads `{ key, at }` pairs off the issue's `ext`, which the page already has. `interleave` (`app/utils/timeline.ts`) puts each one where its time falls among the top-level comments, never between a reply and what it answers; on a tie the comment comes first. Each item is drawn by the layer's component in an element with `id="timeline-<key>"`. A comment's `created` is its file name's compact stamp, so the merge reads both forms through `parseTimestamp`.
- **`inboxSources`**: a layer adds a reason to be in the inbox by naming `IssueFilter` fields, its own included. The inbox runs one static host query (`INBOX_SOURCE_QUERY`, `issues(filter: $filter) { ...IssueListItem }`) per source, for open issues, so a plugin's row is the host's own row. The reason becomes a rail view and a row badge. A reason a built-in view or reason already uses is refused. Plugins need no fragment of their own, which keeps the host's row shape in one place.

Both are documented in `doc/plugins.md`, and covered by `test/nuxt/{slots,timeline,inbox}.test.ts`.

## The poll layer (`packages/plugin-poll/web`)

- **Card:** a poll appears as a card in its issue's discussion, where it was asked. It shows the preamble, a radio or checkbox group per question with an optional write-in, a note, **Vote** / **Change my vote** / **Withdraw my vote**, and the decision once the poll is closed.
- **Results:** hidden until you have a counting ballot, unless the poll says `visible` or is closed. A **Show results** toggle sits in front of them, and the card says why they are hidden.
- **Revocation:** a revoked ballot is announced, and the form is filled in again from what still fits.
- **Editing and closing:** **Edit** warns how many votes saving will revoke, and asks for the save a second time. **Close** starts from what the votes came to, and won't confirm until each tied question is decided (or explicitly left undecided).
- **Elsewhere:** a sidebar panel lists the issue's polls and where you stand, with **New poll**. There is also a row badge, a `poll` chip in the issue filter bar, and **Polls awaiting me** in the inbox.
- **Wiring:** every list a first-party layer joins (`NAVBOOK_WEB_PLUGINS` defaults, the web dependency, dev stack, e2e stack, `.env.example`, READMEs, the CI comment, and the deploy test that pins the defaults).

## Testing

- `packages/web`: vitest (440) and `nuxi typecheck` with all four layers; `tsc -p tsconfig.tools.json`.
- `packages/plugin-poll`: 108 node tests, including the layer's pure helpers (`test/web.test.ts`).
- End to end: `test-e2e/polls.spec.ts` covers two people on one issue:
  - a poll opened from the sidebar lands after an earlier comment;
  - results are hidden, then toggled, then the vote counts;
  - the second person finds it in their inbox's polls view and votes, and the row leaves;
  - an edit revokes both votes and refills the form;
  - a tie must be decided before closing; the decision shows, and reopening clears it;
  - the filter chip and the row badge;
  - the inbox keeps its other rows when the API cannot answer for polls.
- The full Playwright suite (203 tests across the web package and every layer) passed on this branch.
- Screenshots of the card, the editor, the close dialog and dark mode were checked by eye.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
