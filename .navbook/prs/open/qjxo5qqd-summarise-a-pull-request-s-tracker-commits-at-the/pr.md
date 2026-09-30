---
title: Summarise a pull request's tracker commits at the foot of the Changes tab
author: Claude <noreply@anthropic.com>
created: 2026-09-27T09:53:01Z
target: dev
source: feat/tj3a28x6-tracker-activity
reviewer: morgan.peyre@brickcode.tech
labels: [enhancement]
revisions:
  - head: f5b02ac124542c1d633a21c2c86cd4a84a349fac
    base: 1f34c63cd9cbe62573b6bc55f016c68da1e1a7db
    date: 2026-09-27T09:53:01Z
  - head: a0692f00d54cc27977cbc7b3225b09b2f67d0ef1
    base: 2208dead61ce11d704f3709075783cf41f8b7131
    date: 2026-09-30T10:12:33Z
---

Closes #tj3a28x6. The Changes tab now shows only the code at the top. A pull request's tracker commits move into a folded **Navbook activity** timeline at the bottom, one sentence per commit. This is design B of the mockups (https://claude.ai/artifact/9hFaeaztxRbnSvDcRLweJp).

## How the summary is made

There is no model involved: the same commit always reads the same.

- **Core, `packages/core/src/core/activity.ts` (pure, no I/O).**
  - `trackerReads` names the files a summary needs: the record's main file before and after, each added comment, and the main file when the commit left it alone, for the title.
  - `summariseTrackerCommit` turns the subject, the commit's tracker files and those texts into `{ verb, kind, entity, title, facts }`.
  - The verb comes from the subject when it follows `docsSubject`'s grammar or the older `nb: <verb> #id`. Otherwise it comes from the files:
    - main file added → `open`
    - moved between status directories → `close`, `reopen` or `merge`
    - comment added → `comment`, or `review` when it has a verdict
    - `revisions` grew → `update`
    - anything else → `edit`
  - Facts compare the frontmatter before and after, key by key, leaving out `author` and `created`. The title is a fact only when it changes. A description reads "N lines" on open and "edited" after that. Comments carried by a move read "n moved".
- **Git.** `commitsTouchingAsync` walks `base..head -- <navDir>` with `--no-merges`, and `blobAtAsync` is the async twin of `blobAt`.
- **Server.**
  - `Pr.activity(limit)` returns a `TrackerActivity { total, commits: [TrackerCommit] }`, where each commit carries its verb, kind (`Kind`, null when it touched no issue or pull request), entity, title, `facts: [TrackerFact]` and its own tracker `files` with patches.
  - `RevisionCache.activityOf` keeps the answer per `base..head`, like `commitsOf`. It summarises at most 250 commits, 8 at a time.
  - `ChangedFile.tracker` marks the tracker's files in the revision diff.
- **Web.**
  - `DiffView` drops tracker files from the list, the counts and the tab badge.
  - `TrackerActivity.vue` asks for `PR_ACTIVITY_QUERY` on its own, so the diff isn't held up. It stays hidden when there are no tracker commits and is collapsed by default (`aria-expanded`).
  - Each entry has a verb badge, a sentence with a link to the record ("this pull request" for its own), the SHA, author and time, fact chips, and "Show diff (n files)" rendered through `DiffFile`. `DiffFile` gains an `anchor` prop so these ids don't clash with the code files' `file-<n>`.
  - The last line: "Later tracker commits on this PR (reviews, revisions, the merge) are on `<branch>`, not in this diff. They are on the [Conversation tab]." The link drops `?tab`. `<branch>` is the target once merged and the source branch before. The mockup's "dev" is the target of the example PR.
  - A revision that changes only the tracker says "No code changes: this revision changes only the tracker, below." instead of "changes nothing".
- **Rebased onto `dev` at 2208dea.** Features moved into `@navbook/plugin-kb` in the meantime, so core no longer names `specs/`. A commit that touches only a plugin's files names no record and is shown by its subject and its files. Plugins contributing their own summaries would be a follow-up.
- **Docs.** The `web/client.md` and `server/api.md` feature documents describe the section and the field.

## Verification

- Core: 918 pass after the rebase onto `dev` (14 new in `test/activity.test.ts`: close, open, update, title, review, `nb:`, a hand-written subject, reopen and merge, archive, a plugin's files, delete, a map-valued key, several records, marker only).
- Server: 382 pass (5 new in `pr-changes.test.ts`: a close, a hand-written comment and an open, in order, with facts, per-commit files, the limit, and `tracker` on the diff).
- Web vitest: 382 pass (7 new in `activity.test.ts`). `nuxi typecheck`, the root and package `tsc`, and `biome check` are clean.
- E2E:
  - The fixture's unserved PR `bbbb0002` gains a comment on `aaaa0001` inside its revision. That branch isn't served, so no other spec sees it.
  - Two new tests. First, the summary stays "2 files changed" with no `.navbook/` diff, and the header says "1 commit on the tracker" with `aria-expanded="false"` and no timeline. Expanded, it reads `Commented on issue #aaaa0001` with the issue's title, and "Show diff" renders the comment file. The "Conversation tab" link lands on `/prs/bbbb0002` with the Conversation tab current. Second, `bbbb0001`, whose revision has no tracker commit, shows no section.
  - The full suite passes (155), as do the PR spec (28), the CLI (376), conformance (119) and deploy (63).
- By hand, the summariser over this repository's `63a0de2..6b844be` gives the expected sentences for every commit: close, open, edit (including a title change), update, review, comment and merge.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
