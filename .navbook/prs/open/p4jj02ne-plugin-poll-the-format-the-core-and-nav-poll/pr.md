---
title: "plugin-poll: the format, the core and nav poll"
author: Claude <noreply@anthropic.com>
created: 2026-10-05T02:13:52Z
target: dev
source: feat/gel4fvdo-plugin-poll-core
reviewer: morgan.peyre@brickcode.tech
revisions:
  - head: e417568dc50251cec9a0f147ce67e8d4dc95d27f
    base: 11b41b1019658234ecfe1dd553da3d52c7fc14d3
    date: 2026-10-05T02:13:52Z
---

The first of three pull requests for #gel4fvdo: `@navbook/plugin-poll`, polls on issues. This one is the format, the core and the CLI; the server and the web follow, each stacked on the one before.

## What a poll is

An optional Markdown preamble and one or more questions, kept at `poll/<id>-<slug>/poll.md` inside an issue's directory, with each vote a comment-named file beside it. `packages/plugin-poll/doc/spec.md` is normative; in short:

- A question is single- or multiple-choice; an option is a label and an optional Markdown description; a question may accept a write-in (`other: true`).
- A vote is a whole ballot with an optional note. A person's latest vote (by file name, address compared without case) is their ballot; `answers: {}` withdraws.
- Every vote records the fingerprint of the questions it answered (16 hex of the SHA-256 of their canonical JSON; the spec pins a test vector). Changing the questions revokes every ballot; title and preamble edits do not.
- Somebody closes a poll, recording a decision per question: the leader unless they decide otherwise, and a single-choice tie only they can break. Reopening clears it. A poll on a closed issue reads as closed.
- `results: hidden` (the default) is a front-end convention against anchoring, not secrecy: votes are files anybody can read.

## In this pull request

- `src/core`: the entity location, ballots, tallies and decisions (`ballot.ts`), the operations both front ends will call (`ops.ts`), the JSON projection, query terms `poll:` and `poll-awaiting:`, checks X-poll-1 to 3.
- `src/cli`: `nav poll open|vote|show|list|edit|close|reopen`; a section and `polls` JSON on `nav issue show`; completions on `nav issue list`. A plain `nav issue list` still imports no plugin code (the plan had a column there; it would have loaded the plugin on every listing).
- Wiring the deploy suite requires of every `packages/plugin-*`: both images, the release (with a smoke step that opens a poll and reads it back), and the Windows CI run.
- Docs: the package README (including how an agent asks for a decision and reads it back), the root README and `doc/plugins.md`.

The last commit fixes what `/code-review high` found: same-second votes by one person ordered by random ID, archived vote IDs missed by the ID scan, a blank `--other` erasing an answer, numeric option IDs in the walk, revoked picks marked as yours, and late votes counting again after a reopen (now specified and reported).

## Testing

- `packages/plugin-poll`: 82 tests (core over in-memory trees, operations against real repositories, CLI end to end including the interactive walk from a pipe and a lazy-load trace); mutation checks on the late-vote cutoff, address case, fingerprint parsing, same-second ordering and revoked marks.
- `packages/core` (954) and `test/deploy` (79) pass; `nav doctor` on this branch reports what `dev` does.
- The release smoke step was run locally as written.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
