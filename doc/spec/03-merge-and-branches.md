# 3. Branch semantics and merging (normative)

Storing tracker state on code branches means tracker state *forks and merges
with the code*. This is Navbook's superpower (a fix and its issue-close travel
together) and its hardest problem (state can differ between branches). This
document defines what state on a branch means, and how every concurrent-edit
scenario resolves.

## 3.1 The branch of record

- The repository's **default branch** (what `origin/HEAD` designates —
  typically `main`) is the tracker of record. When someone asks "is this issue
  open?", the default branch answers.
- Any other branch shows a **proposed or in-flight state**: a snapshot of the
  record as of its merge-base, plus that branch's staged tracker changes.
  An issue closed on a feature branch is *not closed* until that branch merges
  into the default branch — exactly as a bug fixed on a feature branch is not
  fixed on `main` until merged.
- Tools MUST NOT aggregate tracker state across branches; they report the state
  of the checked-out tree (and MAY additionally label it with the branch name).

**Hygiene (SHOULD):** long-lived branches regularly merge or rebase onto the
default branch, so their tracker snapshot stays fresh; tracker-only changes
(triage, comments on unrelated issues) are committed on the default branch or
short-lived branches, not parked inside long-lived feature branches.

## 3.2 Commit conventions

- Commits that only touch `.navbook/` SHOULD use a message starting with
  `nb: ` (e.g. `nb: close #bqlybac0`, `nb: comment on #dk3mp2x9`) so history
  readers can filter them at a glance.
- To view code history without tracker noise:
  `git log -- ':!.navbook'`. CI pipelines that should not run for tracker-only
  commits SHOULD use an equivalent path filter on `.navbook/`.
- Mixing a code change and its related issue change in one commit is
  legitimate and encouraged where they belong together
  (`fix: raise LB idle timeout` + the issue move + `Closes: bqlybac0`
  trailer).

## 3.3 Concurrency model

The format is designed so that the *frequency* of conflicts tracks the
*genuine contradiction* of the underlying actions:

| Concurrent actions (two branches) | Git outcome | Resolution |
|---|---|---|
| Two new issues/PRs | Distinct directories | Merges clean, always (random IDs) |
| Two comments, same entity | Distinct files | Merges clean, always |
| Comment + metadata edit, same issue | Distinct files (`comments/*` vs `issue.md`) | Merges clean |
| Two edits of the same `issue.md`/`pr.md` | Textual conflict in a small YAML+Markdown file | Resolve by hand; both intents usually compose (e.g. keep both labels) |
| Comment added + issue closed (dir moved) | Directory rename on one side, file addition on the other | Git ≥ 2.18 (merge-ort) relocates the new comment into the moved directory automatically. On older gits, resolve by moving the comment file manually. Same-status result either way |
| Both sides close the same issue | Identical rename | Merges clean if `issue.md` edits are identical; else a small content conflict (e.g. two different `resolution:` values — pick one) |
| Close on one side, reopen (or stay-open edit) on the other | Rename/rename or rename/edit divergence | **Genuine contradiction**; see 3.4 |
| Two PRs merged that both moved their own PR dir | Distinct directories | Merges clean |

## 3.4 Contradictory status changes

When git surfaces a status conflict (or, worse, auto-resolves a rename badly),
the invariant to restore is:

> **An entity ID MUST exist in exactly one status directory.**

`nav doctor` treats a duplicated ID (e.g. the same issue present under
both `issues/open/` and `issues/closed/` after a bad merge resolution) as an
error.

Resolution guidance (SHOULD):

1. Reconstruct intent from git history (`git log --follow` on both paths):
   the *later deliberate action* wins — a reopen performed after news of the
   close is a real reopen; a close racing a stale copy is just a close.
2. When intent is genuinely simultaneous and contradictory, prefer **closed**
   for issues (the close was made with knowledge of a fix; reopening is cheap
   and explicit) and **open** for PRs (a PR wrongly marked merged is worse than
   one wrongly left open).
3. Never resolve by deleting content: comments and revisions from both sides
   are kept regardless of which status wins (they live in distinct files, so
   this is automatic).

## 3.5 The PR self-reference

A PR's files live on the branch it proposes to merge — three consequences are
spec-level facts, not bugs:

1. **The reviewed SHA can never contain its own review.** Approvals are commits
   *after* the `revision.head` they approve. Verifiers MUST check that a
   verdict's `revision` matches a recorded revision entry, not the commit
   containing the verdict.
2. **The target branch does not show open PRs.** Open PRs are discovered by
   enumerating branches (`nav pr list` scans
   `.navbook/prs/open/` across local and fetched remote branches). This is
   inherent to decentralized operation: you see the PRs of the branches you
   have fetched, exactly as you see their code.
3. **Merging is the state change.** The merge that lands the source branch
   carries the PR directory (moved to `prs/merged/`) into the target's
   history. If the mover forgets, the PR arrives in `prs/open/` on the target
   branch; `doctor` flags any `prs/open/` entry whose latest `revision.head`
   is an ancestor of the current branch head as "merged but not archived",
   with the move as the suggested fix.

## 3.6 Scale and housekeeping

Directory-per-entity keeps reads cheap, but unbounded growth of `closed/`
eventually clutters browsing and slows `git status` on very large trackers
(thousands of entries). Housekeeping is deliberate, never automatic:

- An explicit **archive** operation MAY move old closed entities to
  `.navbook/archive/<year>/issues/...` (structure mirroring 2.1). Archived
  entities keep their IDs; references still resolve. This is a reserved
  convention: v1 tools MUST tolerate the `archive/` subtree (treat as closed)
  but need not provide the operation.
- History is never rewritten for housekeeping; `git log --follow` remains the
  audit trail across moves.

## 3.7 Answering Fossil's objections

Fossil's documentation gives the canonical arguments against in-tree issues;
Navbook's answers, for the record:

1. *"Check-ins are immutable, so issues can't be filed against released
   versions."* — Navbook issues live at branch heads and evolve; a release is
   simply a commit whose tree snapshots the tracker as it stood, which is a
   feature (auditable state at every tag), not a constraint on filing.
2. *"Thousands of issue files clutter the tree."* — One dotted root directory;
   path-filtered logs; explicit archiving (3.6).
3. *"Non-committers must be able to file issues."* — True, and out of scope
   for v1; the gateway design reserved in [06-future.md](06-future.md) commits
   on a reporter's behalf without granting them push access.
