---
title: A pull request out of a long-lived branch leaves that branch a commit behind
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-08T14:45:05Z
labels: [enhancement]
feature: [pull-requests, cli]
parent: yoo6arff
---

`nav pr merge` records the merge as a commit on the target branch: the directory move from `prs/open/` to `prs/merged/`, and the `merged:` block appended to `pr.md`. That commit lands on the target and nowhere else.

Where the source is a topic branch about to be deleted, that is the end of it. Where the source is long-lived — `dev` into `main`, which is the shape this repository itself uses — the source is left exactly one commit behind the target, and the same pull request reads `merged` on one branch and `open` on the other.

Observed merging #jy3vjayr:

- Before: `main...dev` was `0 169`. After: `1 0` — the merge fast-forwarded main across the 169 commits and then put `docs(pr): merge #jy3vjayr` on top, which dev did not have.
- `nav pr list status:merged` said `merged`. `nav pr list --all-refs`, in the same working tree, said `open` on `dev`.
- `git merge --ff-only main` from dev settled it, moving nothing but the two renames and the three lines of `merged:` frontmatter.

The disagreement is not cosmetic, because the cross-branch scan is the thing that reports it. `--all-refs` exists so that a pull request living on the branch it proposes to merge can be found from anywhere; a merged pull request that is still open on one fetched ref is exactly the case that scan will surface, and it will surface on every pull request a long-lived branch ever merges. Anybody reading the listing has to know which ref they are looking at to know which answer is the true one, and the file is the record — so the record is briefly wrong on the branch most people are working from.

## What it should do

After a merge that succeeded, and where the source is a local branch that can reach the target by fast-forward, move the source to the target and say so. The result is what a person now has to do by hand, and the reason to automate it is that forgetting produces a wrong answer rather than a stale one.

## Edges it has to respect

- **Fast-forward only.** If the source has taken commits since the revision that was merged, it cannot fast-forward, and resolving that is the person's business. Report what was skipped and why; never open a merge, never write a commit, never leave a conflict behind. That is the same restraint the server keeps in spec 06 §6.3.
- **Local branches only.** A `source:` naming a remote-tracking ref, or a branch this clone does not hold, is not ours to move.
- **Not if it is checked out elsewhere.** Another worktree may hold the source, possibly dirty. Update the ref only where that is safe, and otherwise say what was left.
- **Nothing to do is not a failure.** A source already equal to the target, or a topic branch nobody will touch again, should cost a line of output at most.

## Where it belongs

In core's merge operation rather than in the CLI, so that a second front end gets it rather than reimplementing it — the same reason the derived review state lives in `core/review.ts` and both front ends read it from there.

Merging is not exposed over the API today (`specs/server/api.md`, "Not exposed"), so in practice this is the CLI's behaviour for now. It is worth building it where a gateway would reuse it, because a gateway merging on somebody's behalf is precisely where the discrepancy would go unnoticed: the person who merged is not the person holding the clone.

## Open questions

- **Automatic, or behind a flag?** Automatic, on the grounds that the discrepancy is a fault rather than a preference — with `--no-sync-source` for somebody who wants the target moved and nothing else. The counter-argument is that `nav` does not otherwise move refs the verb was not named after, and a merge that quietly updates a second branch is a surprise the first time.
- **Should doctor notice it independently?** A check for a pull request that is merged on its target and open on another fetched ref would catch the state however it arose — including a merge performed with plain git, which this change cannot reach. That may be the more complete answer, and the two are not exclusive.
