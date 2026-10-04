---
title: nav pr merge's status move rides in the merge commit, so rebasing the target refiles the PR as open
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-10-04T22:32:21Z
labels: [bug]
feature: pull-requests
---

`nav pr merge --no-ff` moves the pull request from `prs/open/` to `prs/merged/` inside the merge commit, and writes the `merged:` block in a single-parent follow-up commit (lifecycle: "moves the directory to `prs/merged/` inside the merge commit and records the `merged:` block in a follow-up"). If the target branch is later rebased without `--rebase-merges`, the record is corrupted with no warning:

1. The rebase drops the merge commit, and the move goes with it.
2. The source branch's commits are replayed one after another, so the pull request is back under `prs/open/`.
3. The follow-up `docs(pr): merge #id` commit modifies `prs/merged/<dir>/pr.md`. That path no longer exists, so git's rename detection applies the change to `prs/open/<dir>/pr.md`.

The result is a pull request filed under `prs/open/` whose `pr.md` carries a complete `merged:` block. The status comes from the directory, so every branch that later merges the rebased target reports it as open. `nav pr list --all-refs` keeps listing it, and `nav doctor` says nothing (#z8s4642m).

## Seen in the brickcode factory repo

On 2026-10-02, 12 pull requests were in this state on `dev`: 10 targeting `rel/*` integration branches and 2 targeting `w0/eri2c3md`. All of those targets had been rebased after their merges. Traced for `#af7sy8sl`:

- Merge commit `76e200882` (two parents): its first-parent diff adds `prs/merged/af7sy8sl-…/{pr.md,comments/…}`.
- Follow-up `dfaf54f7a` `docs(pr): merge #af7sy8sl`: `M prs/merged/af7sy8sl-…/pr.md`, +4 lines (`merged:` with date, by, commit).
- The same commit replayed by the rebase, `93b7215fd`: `M prs/open/af7sy8sl-…/pr.md`, the same +4 lines.

The records survived only on the pre-rebase backup branches. They were repaired by hand with a `git mv` on `dev`.

## Expected

The status move survives a linear rebase. Do the move in a single-parent commit: the follow-up that writes `merged:` can do both. The merge commit then only merges, and replaying it in order (source commits first, then the follow-up) ends with the pull request under `prs/merged/`.

`--rebase-merges` avoids this on the user's side, but nothing tells the user it's needed, and nothing detects the damage afterwards.
