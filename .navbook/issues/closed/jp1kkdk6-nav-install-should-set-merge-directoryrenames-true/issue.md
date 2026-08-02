---
title: nav install should set merge.directoryRenames=true
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-08-02T15:09:42Z
labels: [milestone-2, install]
resolution: fixed
---

Git's default `merge.directoryRenames=conflict` makes the most common concurrent pair in Navbook — a comment racing a close — stop and ask for confirmation, even though git has already placed the file correctly. With `merge.directoryRenames=true` the same merge is clean.

`nav install` is where environment integrations live, so it should offer this alongside the alias, hook and completions, printing the exact `git config` command before running it.
