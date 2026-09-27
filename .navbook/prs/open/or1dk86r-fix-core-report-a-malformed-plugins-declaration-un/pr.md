---
title: "fix(core): report a malformed plugins declaration under D15"
author: Claude <noreply@anthropic.com>
created: 2026-09-27T10:18:22Z
target: dev
source: fix/gqu14qtl-d15-plugins
reviewer: morgan.peyre@brickcode.tech
labels: [bug]
revisions:
  - head: 657e90a270245f2dc647bcfc9e3a3aee725016fe
    base: 47b8901f9b5722b952b96dd4818e59be38182cc5
    date: 2026-09-27T10:18:22Z
  - head: 6d65f5fc8503c1ef76a725366927a1b7ba61aab7
    base: 8e016f0ed50636051246556d0414131e17866828
    date: 2026-09-27T11:00:30Z
---

Fixes #gqu14qtl. D15 now reads the `plugins` declaration that spec 04 §4.3 and spec 02 §2.12 require it to check. This implements the plan in the issue's comments.

## What changes

- **`policy.ts`:** adds `parsePluginDeclaration`, a third reading beside `parseReviewPolicy` and `parseMergePolicy`, with the same fallbacks.
  - Text that is not JSON gives `is not valid JSON`, and anything other than a JSON object gives `is not a JSON object`.
  - A `plugins` value that is not an object gives `'plugins' must be an object`, and nothing is declared.
  - An entry whose value is not an object gives `'plugins."<name>"' must be an object`. Only that entry is dropped; the others stay declared.
  - The key's grammar is not checked, because §2.12 leaves it to the extension (the spec's own example is `@navbook/plugin-kb`). The settings' contents are not checked either.
- **`tree.ts`:** `Repo.plugins` carries the reading.
- **`validate.ts`:** `checkMarker` reports its problems. The existing `seen` set still collapses the shared "is not valid JSON" fault into one diagnostic.
- **`workspace.ts`:** adds `readPluginDeclaration(ws)` for the plugin tooling to build on. Nothing reads it yet.
- **One change from the plan:** the declaration map is built with `Object.fromEntries`, so a plugin named `__proto__` is stored as an ordinary entry and does not replace the object's prototype. A unit test covers this.

Nothing here loads, resolves or installs anything, so the `worktree-plugins` branch can build on `repo.plugins.declaration` without a conflicting reading.

## Conformance fixtures

| Fixture | Marker | Expects |
|---|---|---|
| `valid/plugins` | a scoped name, a settings object and an unknown top-level key | no diagnostics |
| `invalid/d15-plugins` | `"plugins": ["@navbook/plugin-kb"]` | 1 × D15 |
| `invalid/d15-plugins-null` | `"plugins": null` | 1 × D15 |
| `invalid/d15-plugin-settings` | entries `true`, `{}` and `null` | 2 × D15 |
| `invalid/d15-two-faults` | a bad `review.minApprovals` beside a good and a bad plugin entry | 2 × D15 |

All four `invalid` fixtures fail against the previous core, and the unit tests fail against the old `src/` in the same way.

## Before and after

```console
$ cat .navbook/navbook.json
{ "version": 1, "plugins": ["@navbook/plugin-kb"], "review": { "minApprovals": "two" } }
$ nav doctor            # before
error  D15  .navbook/navbook.json: 'review.minApprovals' must be a whole number of at least 1
1 error, 0 warnings
$ nav doctor            # after
error  D15  .navbook/navbook.json: 'plugins' must be an object
error  D15  .navbook/navbook.json: 'review.minApprovals' must be a whole number of at least 1
2 errors, 0 warnings
```

`nav doctor --staged` now reports the same faults, so the pre-commit hook stops them.

## Checks

- `biome check .`: clean.
- `tsc --noEmit` at the root and in core, cli and server: clean.
- Tests: core 830/830, cli 376/376, server 377/377, conformance 124/124.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
