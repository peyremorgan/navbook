---
title: Test plans and test runs, attachable to a pull request (plugin-tests)
author: Claude <noreply@anthropic.com>
created: 2026-09-29T01:13:47Z
labels: [enhancement, plugin]
assignee: Claude <noreply@anthropic.com>
subtasks: [w5zohlcn]
---

A new plugin, `@navbook/plugin-tests` (short `tests`, CLI noun `nav test`), for manual test plans and the runs that record executing one.

- A **plan** is a standing document at `tests/<slug>/plan.md`: a description, then one `### <title>` section per step with `#### Actions` and an optional `#### Expected`.
- A **run** is one file named like a comment (`<stamp>-<id>.md`). Attached to a pull request it lives in the PR directory (`prs/<status>/<dir>/tests/`) and travels with it; standalone it lives in `tests/<slug>/runs/`. Frontmatter: `plan`, `plan-sha`, `author`, `started`, `finished`, `commit` and/or `version`, `environment`. Body: one `### N. <title>` per recorded step with `#### Status` (passed, failed, blocked, skipped) and an optional `#### Actual`. Unrecorded steps are not run.
- The outcome is derived, never stored: failed, then blocked, then passed (all recorded; all skipped gives skipped), then incomplete (finished) or in-progress.
- CLI: `nav test open|list|show|edit|run|record|resume|finish|runs|attach`; `run` walks the steps interactively. `nav pr show` gets a test runs section, `nav pr list` a `tested:` term.
- Web: `/tests` pages, a structured plan editor, a runner with Save progress and Finish, a test runs panel on the PR page, a badge and a `tested` filter on PR lists.
- Attachments may sit beside a run in a directory named like it.

Design recorded in the planning session: research across TestRail, Xray, Zephyr, Kiwi TCMS, TestLink, Squash TM, Azure Test Plans, Qase, Testmo, Testiny, Allure and the open formats (JUnit, CTRF, TAP, Cucumber, TestLink XML, ISO 29119-3) found no plaintext format with per-step expected and actual results. The subtasks below track the stages.

Deferred, tracked separately: `feature:` on plans, and export to CTRF/Xray JSON.
