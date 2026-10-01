---
title: Test plans and test runs, attachable to a pull request (plugin-tests)
author: Claude <noreply@anthropic.com>
created: 2026-09-29T03:50:02Z
target: dev
source: feat/z9yqtsbv-plugin-tests
reviewer: morgan.peyre@brickcode.tech
labels: [enhancement, plugin]
revisions:
  - head: f80e8089f6a02f816d35b3cc63490a9dc40f8005
    base: 7083ddd12cb4c77d958683a4540c86f9613f9391
    date: 2026-09-29T03:50:02Z
  - head: ee8018a8119a2237844c3887bd9c084044402693
    base: 71a0111d4a058212fe8e75b0c6fa2e1f41b103fc
    date: 2026-09-30T13:46:37Z
  - head: 937fe5a47542f909b54a5891628dda861513a29f
    base: 9097617bd4d24690684bab67cc0d8c7d717f6546
    date: 2026-10-01T01:00:06Z
merged:
  date: 2026-10-01T01:00:27Z
  by: Claude <noreply@anthropic.com>
---

Adds `@navbook/plugin-tests`: manual test plans kept in the repository, and runs that record executing them, standalone or attached to a pull request. Closes #z9yqtsbv.

## What it adds

- **Format.** A plan is `tests/<slug>/plan.md`: a description, then one `### <title>` per step with `#### Actions` and an optional `#### Expected`. A run is a `<stamp>-<id>.md` file, either under `tests/<slug>/runs/` or in a pull request's `tests/` directory, so it moves with the PR. It records `plan`, `plan-sha`, `steps`, `commit` and/or `version`, and one `### N. <title>` per step with `#### Status` and `#### Actual`. The outcome is derived, never stored. The normative spec is `packages/plugin-tests/doc/spec.md`, with checks X-tests-1 to X-tests-3.
- **CLI.** `nav test open|list|show|edit|run|record|resume|finish|runs|attach`. `run` walks the steps interactively and writes each answer as it is given. `nav pr show` gains a test runs section, and `nav pr list` gains `tested:`.
- **API.** `TestPlan` and `TestRun`, five mutations, `Pr.testRuns` and `Pr.tested`, and a `tested` pull request filter. Attachments travel as base64: 5 MiB per file in, 20 MiB out.
- **Web.** A `/tests` section, a structured plan editor, and a runner that keeps answers in the browser until Save progress or Finish. Each pull request gets a test runs panel, its row gets a badge, and the filter bar gets a chip.

## Changes outside the plugin

- **Core.**
  - Entity locations let a plugin keep data inside an entity's directory, readable by pure query keys and by the ref scan.
  - There is a `write-bytes` op, and doctor gets tools to read blobs and check commits.
  - `applyOps` now refuses to write through a symbolic link under the Navbook root.
  - `PLUGIN_API_VERSION` is 1.1.0.
- **CLI.** Plugins get `ui.ask`, `ui.isInteractive` and `ui.editText`. A verb that a plugin only completes no longer loads that plugin.
- **Server.** Plugins get `api.writeTarget`.
- **Web host.** `PrRow` renders row badges. The build, the e2e stack and the dev stack load both plugins, and the fixture seeds a plan and two runs.
- **Packaging.**
  - Both Dockerfiles carry the plugin, and the release packs, smoke-tests and publishes it.
  - The deploy tests now require every `packages/plugin-*` to be released, copied into both images and packed.

## Things to know when merging

- **API image.** The #uniyh2hy fix is on dev now, and this branch adds `--filter "@navbook/plugin-tests..."` to its install step. Both images build with both plugins, and the API image loads both at 0.5.0. Before the rebase, an image built with that fix applied by hand served plans, finished and pushed a run, and returned an attachment against a signed token.
- **Coordination with #yp56dc43.** It replaces `writeTarget` with `writeEntity`. If it lands first, this plugin's server half moves to the new call.
- **Not declared here.** This repository's own `navbook.json` does not declare the plugin. Declaring it would make the deployed API refuse to start until its image carries it.
- **Follow-ups.** Two deferred items are filed separately: #l2xyp1u5 (plans attached to features) and #w5m6r8im (CTRF and Xray export).

## Tests

| Suite | Result |
|---|---|
| core | 933 passed |
| cli | 416 passed |
| server | 436 passed |
| plugin-kb | 145 passed |
| plugin-tests | 120 passed |
| conformance | 128 passed |
| deploy | 81 passed |
| web vitest | 426 passed |
| Playwright | 182 passed, 10 of them the plugin's |

Under heavy load, two server timing tests failed once in a full run: the maintenance stop and the plugin service stop. Both passed on rerun alone, and neither involves this branch's code.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
