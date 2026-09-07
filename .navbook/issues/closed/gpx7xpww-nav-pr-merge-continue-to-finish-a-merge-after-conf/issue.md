---
title: nav pr merge --continue, to finish a merge after conflict resolution
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-08-02T15:09:43Z
labels: [milestone-3, pr]
resolution: fixed
feature: pull-requests
---

When `git merge` conflicts inside `nav pr merge`, the directory move to `prs/merged/` and the `merged:` block still have to happen once the human has resolved the conflict.

Leaving the merge in progress and asking the user to do both steps by hand is workable but easy to forget; doctor's D9 is only a safety net. A `--continue` verb that detects the resolved in-progress merge and finishes the job is the better contract.

This adds command surface that spec 04 does not yet describe, so it needs a matching spec amendment.
