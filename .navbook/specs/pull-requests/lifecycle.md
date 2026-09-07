---
title: Lifecycle
---

## What exists

A pull request is `prs/{open,merged,closed}/<id>-<slug>/pr.md` on its own source branch, with an append-only `revisions:` list pinning the exact `head` and merge `base` under review (spec 02 §2.7, §2.8).

- **Open** — `nav pr open [--target BRANCH] [--title T] [--draft] [--reviewer EMAIL]` on the current branch, pinning one revision. The title defaults to the last commit's subject.
- **Update** — `nav pr update` appends a revision for the current `HEAD`, refusing when it equals the last recorded head.
- **Request a review** — `nav pr request <id> <email>...` writes `reviewer:` on `pr.md`; `--remove` takes people off. Being listed is the request, and nothing records it answered — see [Reviews and review requests](reviews.md).
- **Review** — `nav pr review [--approve|--request-changes|--comment]`, bound to the latest revision unless `--revision` says otherwise, with `--file` and `--line` for an inline anchor. Without a verdict flag it records `comment`, a review that judges nothing. A verdict on one revision carries nothing to the next (spec 03 §3.5).
- **List** — `nav pr list` shows what the checked-out tree holds; `--all-refs` scans every local and fetched remote branch, since a target branch does not show open pull requests.
- **Merge** — `nav pr merge [--no-ff]` from the target branch moves the directory to `prs/merged/` inside the merge commit and records the `merged:` block in a follow-up. `--continue` finishes a merge that stopped for conflicts; it never aborts one.
- **Close and reopen** — `nav pr close` records a declined pull request under `prs/closed/`, checking its files out from the branch that carries them when this one does not. A merged pull request cannot be reopened.
- **Delete** — acts on the checked-out tree alone, by design.

The API reads pull requests, takes comments and reviews, and patches a pull request's metadata with `updatePr` — the twin of `updateIssue`, carrying `reviewers` as well. It refuses either write on a pull request whose branch it does not serve, naming the branch. Opening, updating, merging and deleting are checkout-centric and are not exposed (spec 06 §6.3).

## Where it lives

- `packages/core/src/ops/pr.ts`, `packages/core/src/core/review.ts`, `packages/core/src/git/{refscan,merge}.ts`
- `packages/cli/src/commands/pr.ts`
- Web: `/prs`, `/prs/[ref]`

## Drift from the specification

- Spec 02 §2.7 gives a pull request `superseded-by:` (with `resolution: superseded`) and no `duplicate-of:`. `nav pr close` offers `--duplicate-of` and writes `duplicate-of` onto `pr.md`, which `validatePr` accepts as an unknown key; there is no `--superseded-by`. Reopening does clear both keys.
- Spec 04 §4.3 writes `[-m TEXT | --edit]` on `pr review` and `pr comment`; no `--edit` flag exists (see the issues feature).
- The comment on `applyComment` in `packages/core/src/ops/entity.ts` says a review is filed under `reviews/`. It is filed under `comments/`, as spec 02 §2.6 says; the comment is stale, the behaviour is right.
