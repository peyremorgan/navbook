---
title: Record who was asked to review, and let a review judge nothing
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-07T17:57:16Z
labels: [enhancement]
feature: pull-requests
resolution: fixed
---

A pull request records who reviewed it and what they said, but nothing records who was *asked*. Add the request, and the third verdict every forge has and this format lacks.

**`reviewer:` on `pr.md`**, a person or a list of persons, written and validated exactly as `assignee` is (§2.5, §2.7). Being listed *is* the request: there is no second key saying whether it is still outstanding, because a reviewer's approval would then have to edit `pr.md` and race the author's own edits (§3.3). Whether a request is still pending is derived instead — a listed person with no verdict bound to the latest revision — which also means appending a revision re-requests everybody, for the same reason a verdict never carries forward.

**`verdict: comment`** joins `approve` and `request-changes`: a review that says "I looked" and judges nothing. It carries a `revision` like any review and satisfies a request, but never counts toward the decision. `nav pr review` writes it when no verdict flag is given, since the review verb should record a review; `nav pr comment` remains the way to say something without judging a revision.

**Derived state.** A person's state on the latest revision is their latest opinionated verdict there, else `commented` if they left a comment review, else `pending`. The pull request's decision is `changes-requested` if anyone is blocking, else `approved` if anyone approved, else `pending`. The block shows listed reviewers and volunteers alike, and ignores the author throughout: a self-approval is recorded like any other comment and counts for nothing.

**Surfaces.** `nav pr request <id> <email>... [--remove]` and `nav pr open --reviewer`; query terms `reviewer:`, `review:` and `awaiting:`, the last being the "what do I owe" queue; an `updatePr` mutation mirroring `updateIssue`, with `reviewers`, `reviews` and `reviewDecision` on the API; and in the browser a reviewers panel, a decision badge, an "Awaiting me" toggle and a fourth choice in the review form.

Navbook records reviews and enforces no policy (§1.7), so the decision is a reading of what the files say, never a gate.
