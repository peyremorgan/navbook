---
title: Configurable review policy in navbook.json
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-08T00:24:27Z
labels: [enhancement]
feature: pull-requests
resolution: fixed
parent: b26np83t
---

`navbook.json` should be able to say what a review is supposed to add up to: whether a pull request's own author may review it, and how many approvals `approved` takes.

```json
{ "version": 1, "review": { "selfReview": false, "minApprovals": 2 } }
```

Both keys are optional, and their defaults reproduce today's rule exactly: the author is excluded, and one approval is enough.

It stays advisory. Spec 01 §1.7 and 02 §2.7 keep their promise — the decision is a reading of the files, and no tool refuses an operation on the strength of it. What a declared policy changes is what the reading counts and what the tools *say*: `nav pr show` reports "1 of 2 approvals", and `nav pr merge` prints the shortfall and asks before merging short of it. `--yes` skips the question, and a run with no terminal proceeds with a warning. Nothing is ever refused.

A malformed policy is a doctor error (D15) rather than a failed command: every surface falls back to the defaults and warns, because a marker somebody mistyped should not stop them listing their pull requests.
