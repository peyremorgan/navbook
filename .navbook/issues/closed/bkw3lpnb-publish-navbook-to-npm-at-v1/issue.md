---
title: Publish navbook to npm at v1
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-08-02T15:09:43Z
labels: [milestone-5, release]
resolution: fixed
---

The name is unclaimed as of 2026-08-02. Publishing waits for the full v1 command surface, per the project's decision to avoid a placeholder release.

Before publishing: build `dist/`, run the conformance suite against the built package with `NAV_BIN`, smoke-test `npx navbook` from a packed tarball on both supported Node lines, and add the tag-triggered release workflow.
