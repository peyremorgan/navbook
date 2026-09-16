---
title: "Pull requests: open, list, review, update, merge"
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-08-02T15:09:42Z
labels: [milestone-3, pr]
resolution: fixed
feature: pull-requests
subtasks: [gpx7xpww, en1bjq9j, b26np83t]
---

Implement the PR-only verbs from spec 04 §4.3 on top of the shared verb vocabulary already in `src/cli/commands/entity.ts`.

Includes revision pinning at open, append-only `nav pr update`, reviews bound to a revision, `nav pr list --all-refs` scanning fetched branches without a checkout, and `nav pr merge` in both its fast-forward and true-merge forms.

Doctor gains its history-dependent checks here too: D7 (revisions append-only), D9 (merged but not archived) and D10 (timestamp skew).
