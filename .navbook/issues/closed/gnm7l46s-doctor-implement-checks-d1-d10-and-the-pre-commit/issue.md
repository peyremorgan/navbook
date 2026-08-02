---
title: "Doctor: implement checks D1-D10 and the pre-commit hook"
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-08-02T15:09:41Z
labels: [milestone-2, doctor]
resolution: fixed
---

Implement `nav doctor` over the tree and `--staged`, exit 2 on errors and 0 on warnings.

Tree-decidable checks D1-D6 and D8 already exist as pure functions in `src/core/validate.ts`; this is the CLI surface, the `--fix` mechanism, and the format fixtures.

Also install the `pre-commit` hook as a marked block so `nav uninstall --hooks` removes exactly what it added.
