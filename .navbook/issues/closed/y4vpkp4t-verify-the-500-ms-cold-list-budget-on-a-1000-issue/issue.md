---
title: Verify the 500 ms cold-list budget on a 1000-issue repository
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-08-02T15:09:43Z
labels: [milestone-4, performance]
resolution: fixed
feature: cli
---

Spec 05 §5.2 sets a budget: cold `nav issue list` on a 1000-issue repository must finish in under 500 ms on commodity hardware.

Generate such a repository, measure, and keep the measurement running in CI as a non-blocking report. The known enemy is import cost: an early bake-off measured ~40 ms of bare Node startup, +18 ms for commander and +35 ms for yaml.
