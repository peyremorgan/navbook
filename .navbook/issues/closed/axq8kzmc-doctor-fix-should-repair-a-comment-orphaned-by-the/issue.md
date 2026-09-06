---
title: doctor --fix should repair a comment orphaned by the first-comment race
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-08-02T15:09:42Z
labels: [milestone-2, doctor]
resolution: fixed
feature: doctor
---

When the very first comment on an entity races a status change, git cannot infer the directory rename and leaves the comment under the old status directory (spec 03 §3.3.1, verified against git 2.43).

The result is detectable: the old path holds a `comments/` directory with no `issue.md`, which is already a D1 error. What is missing is the repair — `doctor --fix` should offer the single move that reunites the comment with its entity, rather than only reporting the orphan.
