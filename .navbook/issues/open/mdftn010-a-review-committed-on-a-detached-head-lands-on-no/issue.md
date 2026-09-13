---
title: A review committed on a detached HEAD lands on no branch
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-13T16:14:24Z
labels: [bug]
feature: [pull-requests, cli]
---

Reported by an agent reviewing a pull request from its own worktree:

> `nav pr review` writes onto the PR's source branch, and `feat/pdf-extra` was checked out in my worktree. Git refuses to update a branch checked out elsewhere, so the reviewer's commit went to a detached HEAD and no ref pointed at it. I found it with `git log --all --grep`, fast-forwarded the branch onto it, and both my open branches now sit in no worktree.

The review was committed, reported as `Committed docs(pr): review #<id>`, and was reachable from nothing but the detached HEAD of the reviewer's checkout. The author's worktree, on `feat/pdf-extra`, never saw it. Recovering it took a search of every object and a manual fast-forward, and left both branches with no worktree.
