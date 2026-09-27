---
title: "fix(doctor): read the marker's version, and warn when the tree is newer"
author: Claude <noreply@anthropic.com>
created: 2026-09-27T20:42:10Z
target: dev
source: fix/d9ffyep0-marker-version-v2
reviewer: morgan.peyre@brickcode.tech
revisions:
  - head: f89be632f3a957eefe915aa19e0437965e18b3fe
    base: ec8ba495941cf3a33b40c41434b926fa29af77f8
    date: 2026-09-27T20:42:10Z
---

Fixes #d9ffyep0: `nav doctor` never read the marker's `version`, so a tree from a newer Navbook, or a mistyped version, passed as sound.

**What changes**
- `version` absent or `1`: no diagnostic, as before.
- A whole number above `1`: a new check, **D16**, at *warning* level ("written by a newer Navbook; update nav"). `nav doctor` still exits 0, so the pre-commit hook does not refuse every commit until somebody upgrades.
- Anything else (`"1"`, `null`, `1.5`, `0`, `true`, `[]`, `1e400`): a **D15** error, beside the other marker faults.
- A marker that is not JSON: still exactly one D15. The version reader leaves that fault to the policy readers.
- `pr list`, `pr show` and `pr merge` already print the marker's faults. They now lead with the newer-format warning.

**Where**
- Core:
  - `parseMarkerVersion` in `core/policy.ts`, stored on `Repo.versionFault`.
  - `checkMarker` in `core/validate.ts` (D15/D16).
  - `readMarkerVersion` in `workspace.ts`.
- CLI: `warnNewerFormat` in `commands/policy.ts`, called from `pr list`, `pr show` and `pr merge`.
- Spec:
  - 02 §2.10 defines the two cases.
  - 04 §4.3 adds D16 to the table and says why it is a warning. Its "future `D16`" example becomes `D17`.
  - The check range is updated in 05 and in the fixtures README.
- Fixtures: `format/invalid/d15-marker-version` and `d16-newer-format`. The second one asserts exit 0.
- `schema.graphql`: the description of `Diagnostic.check` now reads D1–D16 or `X-`. The generated server types are regenerated.

This PR starts again from dev. It replaces the closed PR `na3o4794`, which was hundreds of commits behind, and keeps that PR's design.

**Verified**
- In the worktree:
  - biome and tsc (root, core, cli, server, plugin-kb) pass.
  - Test suites: core 874, cli 399, server 370, plugin-kb 138, conformance + deploy 196. All pass.
- New tests:
  - 4 of the new validate tests fail against the old `src/`, which shows they are not vacuous.
  - A CLI test checks that doctor exits 0 with D16, and that `pr list --all-refs` and `pr show` warn on stderr.
- Scratch repo with the workspace CLI:
  - `2` and `99` give D16.
  - `"banana"`, `null`, `1.5` and `0` give D15.
  - `1` and an absent key pass.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
