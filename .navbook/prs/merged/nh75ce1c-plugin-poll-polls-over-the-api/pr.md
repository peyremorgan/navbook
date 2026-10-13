---
title: "plugin-poll: polls over the API"
author: Claude <noreply@anthropic.com>
created: 2026-10-05T02:27:40Z
target: dev
source: feat/gel4fvdo-plugin-poll-server
reviewer: morgan.peyre@brickcode.tech
revisions:
  - head: 131891a2023a811221833cf1441a0c38628a540f
    base: 11b41b1019658234ecfe1dd553da3d52c7fc14d3
    date: 2026-10-05T02:27:40Z
  - head: 0cd3b5ff847982c52bcc8eab012076836064d2bf
    base: 11b41b1019658234ecfe1dd553da3d52c7fc14d3
    date: 2026-10-05T03:07:25Z
  - head: ee790d1619dd9f02cd7ee805deb4fc7e2825145d
    base: 3ab6b1a756de37a4b16fab2301990a48cb998177
    date: 2026-10-13T23:33:30Z
merged:
  date: 2026-10-13T23:33:39Z
  by: Claude <noreply@anthropic.com>
---

The second of three pull requests for #gel4fvdo: the API half of `@navbook/plugin-poll`. It is stacked on #p4jj02ne (the format, the core and `nav poll`), whose commits it carries until that one merges; review the commits from `feat(poll): polls over the API` on.

## In this pull request

- `schema.graphql`: a `Poll` type (questions, fingerprint, status, outcome and proposed decision, tallies, votes and their states), `Query.poll`, `Issue.polls`, and five mutations: `openPoll`, `editPoll`, `votePoll`, `closePoll`, `reopenPoll`. Every input is typed (the host's `JSON` scalar is output-only).
- `src/server/index.ts`: each mutation runs the operation `nav poll` runs, in the host's write transaction, and reads the poll and its issue back for the payload. A ballot is the signed-in person's; `myState`, `myBallot` and `myDraft` (their last answers, less what no longer fits) are the viewer's.
- Stale forms are refused: a vote carries the fingerprint its form was built from, and an edit, a close or a reopen the `baseSha`.
- `IssueFilter.polls` and `IssueFilter.pollAwaiting`, onto the core's `poll:` and `poll-awaiting:` terms, read with the same helpers as the terms. `ext.poll` lists an issue's polls (ID, title, created, status, voters) for its row, the same for every viewer.

It also carries one core fix found while writing it: a poll is closed no earlier than its latest vote. A quick revote is stamped a second after the voter's last one and can run ahead of the clock, so a close right after it made the very vote it counted read as late.

The last commit fixes what `/code-review high` found: a ballot cast without a note now keeps the last one (as the CLI does), the per-vote `writeTarget` that parsed every comment is gone, the filter/term validation is shared, and vote states are computed once per poll.

## Testing

- `packages/plugin-poll`: 94 tests, 11 of them over a real server with three signed-in people (open, vote, refusals, filters, edit and revocation, withdrawal, tie, close, reopen, a poll its issue closed).
- `test/deploy` passes; the lockfile is checked offline with `--frozen-lockfile`; `tsc -p tsconfig.build.json` builds `dist/server/` with no runtime import of the server.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
