---
title: Reviews and review requests
---

## The request

`reviewer:` on `pr.md` names the people asked to review, in the shape `assignee` takes: one person as a scalar, several as a flow list (spec 02 §2.7). Being listed is being asked, and that is the entire record of the request.

Nothing marks a request answered. The alternative — a key the reviewer's commit clears — would put every review into `pr.md`, the one file the author is also editing, and manufacture the conflict of spec 03 §3.3 out of two actions that do not contradict each other at all. A review is a comment file, and it stays one.

## The derived state

Everything about "who still owes a look" is computed from the comments, against the pull request's **latest revision**:

- A person's state there is their latest opinionated verdict (`approve`, `request-changes`), else `commented` if they bound a `comment` verdict to it, else `pending`.
- The people counted are those `reviewer:` names plus anyone else who bound a verdict to that revision — a volunteer's review is a review. The author is excluded from both the listing and the decision, unless the policy allows self-review.
- The decision is `changes-requested` if anyone blocks, `approved` if at least `minApprovals` people approve and nobody blocks, `pending` otherwise.

Appending a revision returns everybody to `pending`, which is the rule that a verdict binds to one revision, seen from the request's side: nobody has to remember to re-request after a force-push.

Ordering within one revision is by comment filename — a UTC timestamp to the second, then the comment's ID — which is the order the thread renders in. Two reviews by one person on one revision are not a contradiction to resolve; the later one is simply what they now say, and two written inside the same second are ordered by their IDs, so the state and the thread always agree even where the clock cannot separate them.

## The policy

`navbook.json` may carry a `review` object saying how the above is counted (spec 02 §2.10): `selfReview`, whether the author is among the people counted, and `minApprovals`, how many approvals `approved` takes. Both default to what §2.7 describes without them — no self-review, one approval — so a repository that declares nothing, and every repository written before the key existed, reads exactly as it did.

It is advisory, and that is not a hedge about enforcement arriving later. What a policy changes is what the reading counts, and therefore what every surface reporting that reading says. It never changes what anything does:

- `nav pr merge` prints what is missing and asks `Merge anyway? [y/N]`. `--yes` answers in advance; a run with no terminal warns and merges, because a pipeline that stopped for a question nobody can answer would be a gate arrived at by accident. Answering no exits 1 — the operator's decision, not the tool's. `--continue` reports and never asks.
- `nav pr review --approve` on your own pull request writes the file and warns that it will not count. The review is a record of what somebody said and is never refused; the warning is against believing the decision moved.
- A malformed policy is doctor error D15. Every reader falls back to the defaults, per key, and says so on stderr — the marker names the directory, and a typo in it should not stop somebody listing their pull requests.

## The third verdict

`verdict: comment` is a review that judges nothing (spec 02 §2.6). It binds to a revision like any review and satisfies a request, and it never counts toward the decision. `nav pr review` writes it when no verdict flag is given, because that verb files reviews; `nav pr comment` is how to say something bound to no revision at all. An inline anchor (`--file`) without a verdict flag stays a plain comment: a note about one line does not claim its author read the revision.

## Surfaces

- `nav pr request <id> <email>... [--remove]`, `nav pr open --reviewer`, and `nav pr review --comment`. Requesting refuses a name that is not a person, the author's own pull request, and a change that would change nothing; removing accepts any name, because that is how a hand-written mistake is undone.
- Query terms `reviewer:`, `review:` and `awaiting:`, the last being the queue of what a person owes. All three are pull-request-only and rejected on `nav issue list`.
- `nav pr show` lists each reviewer with their state, the approvals counted where more than one is wanted, and the declared policy; `nav pr list` gains a `reviewer` column when any row has one, and a `review` column carrying the decision. `--json` carries `review.approvals` and `reviewPolicy`.
- `nav pr merge` takes `--yes`, and says what a declared policy is missing.
- The API exposes `reviewers`, `reviews`, `reviewDecision` and `approvals` on `Pr`, `reviewPolicy` on `Query`, the three filter fields, and `updatePr` — the pull-request twin of `updateIssue`, patching the same metadata plus `reviewers`.
- The web client shows the panel, the badge with its shortfall, the policy beneath the reviewers, and an "Awaiting me" toggle, and edits the reviewer list in place.

None of it gates anything. `nav pr merge` merges a pull request nobody approved, and merges one short of the policy the repository declared — it only says so first (spec 01 §1.7).

## Where it lives

- `packages/core/src/core/review.ts` — the derived state, shared by every front end
- `packages/core/src/core/policy.ts` — the policy the marker declares; `workspace/workspace.ts` reads it where no tree is loaded
- `packages/core/src/core/files.ts` — the `reviewer` key and the verdict vocabulary
- `packages/cli/src/commands/pr.ts` — `request`, `review`, `merge`; `commands/policy.ts` — what to say and whether to ask
- `packages/server/src/resolvers/` — `updatePr`, the derived fields, `reviewPolicy`
- `packages/web/app/components/{ReviewList,ReviewBadge,ReviewPolicyNote}.vue`, `app/utils/reviews.ts`, `app/pages/prs/[ref].vue`
