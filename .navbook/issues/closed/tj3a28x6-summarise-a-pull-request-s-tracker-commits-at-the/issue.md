---
title: Summarise a pull request's tracker commits at the bottom of the Changes tab, collapsed
author: Claude <noreply@anthropic.com>
created: 2026-09-27T09:28:10Z
assignee: Claude <noreply@anthropic.com>
labels: [enhancement]
feature: [web, server]
resolution: fixed
---

A pull request's Changes tab mixes two kinds of change. The code is what the reviewer opened the tab for. The tracker files ride along on the branch: the PR's own `pr.md`, an issue closed with the fix, comments. Today they are listed last (`RevisionCache.ordered` in `packages/server/src/changes.ts`), but as ordinary diffs, counted in the summary and the tab badge, with nothing to say what each one did. In #rw1mjrnv, 5 of the 11 files are tracker files, and closing #ozzaoa36 reads as four renames and a one-line `+resolution: fixed`.

## What we want

Design B of the mockups ("Changelog of Navbook commits", https://claude.ai/artifact/9hFaeaztxRbnSvDcRLweJp):

- **Code only at the top.** The summary line ("6 files changed, +280 −22"), the file list and the tab badge count code files only. Tracker files are no longer rendered as diffs there.
- **A "Navbook activity" section at the bottom, collapsed by default.** Its header says how many tracker commits the revision holds ("2 commits on the tracker, kept out of the diff above"). It shows nothing when there are none.
- **Expanded, it is a timeline**, one entry per commit in `base..head` that touches the tracker, oldest first:
  - a verb badge (`open`, `close`, `comment`, `review`, `edit`, …) and one sentence: "Closed issue `#ozzaoa36` as **fixed**", "Opened this pull request against `dev`";
  - the short SHA, author and date;
  - the record's title when it isn't this PR;
  - small fact chips for what changed in the frontmatter: `resolution: — → fixed`, `open/ → closed/`, `labels bug, cli`;
  - "Show diff (n files)", which opens that commit's tracker files with the existing diff rendering.
- **A last line**: "Later tracker commits on this PR (reviews, revisions, the merge) are on `<branch>`, not in this diff. They are on the [Conversation tab]." The last two words link to the Conversation tab (`?tab` removed from the address).

## The summary has to be deterministic

There is no LLM on the tracker server. Everything is derived from git and the format:

1. **The commit subject**, when it follows the grammar `--commit` writes: `docs(<issue|pr|feature>): <verb> #<id>`, or the older `nb: <verb> #<id>`. It gives the verb and the record.
2. **The commit's own diff of the tracker directory**, which covers commits written by hand and checks the subject:
   - `issue.md` / `pr.md` / `feature.md` added → open;
   - the entity directory moved between status directories → close, reopen or merge, plus the `resolution` it gained;
   - a file added under `comments/` → comment, or review with its `verdict`;
   - `revisions` gained an entry → update (a new revision pinned).
3. **Frontmatter facts**: parse the main file before and after the commit with core's `parseFile` and compare the keys. `title`, `author` and `created` are left out. Lists are shown as added and removed values, `revisions` as a count. A body that changed is "description edited (+a −d)".

A commit whose subject matches no verb is shown with its subject as written, plus the facts from step 2.

## Out of scope

- The Commits tab stays as it is.
- The tracker commits after the pinned head (review, update, merge) are not fetched. The last line points to the Conversation tab for them.
