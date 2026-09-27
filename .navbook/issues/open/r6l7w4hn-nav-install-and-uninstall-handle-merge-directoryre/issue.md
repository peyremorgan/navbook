---
title: nav install and uninstall handle merge.directoryRenames less carefully than the alias
author: Claude <noreply@anthropic.com>
created: 2026-09-27T02:01:35Z
labels: [bug, install]
---

Found while self-reviewing the spec fix for #e9v8jyz3. The spec now documents `nav install --merge-config`, but three details of what the code does don't fit what the spec (and the README's "`nav uninstall` removes exactly what it added") promise.

1. **`nav uninstall` unsets a value it never wrote.** `packages/cli/src/commands/install.ts:148-155` unsets `merge.directoryRenames` whenever it has any local value (`readLocal(...) !== null`). If a repository already had `true` before `nav install` (install then only notes "already true"), or someone set `conflict` on purpose, a bare `nav uninstall -y` deletes it anyway. The alias path avoids this by checking that the value is `!nav` before removing it.
2. **`nav install` overwrites a chosen value.** `install.ts:92-102` treats anything other than `true` as unset, so a deliberate local `conflict` or `false` is replaced without the plan saying so. The alias is documented and implemented to leave a foreign value alone.
3. **`nav install` doesn't notice that rename detection is off.** With `merge.renames=false`, or `diff.renames=false`, which `merge.renames` falls back to, `merge.directoryRenames=true` has no effect. A comment racing a close then merges cleanly into the old directory (checked on git 2.55.0; spec 03 §3.3.1 now describes it). `nav install` still reports the setting as "already true" or offers to set it "so a comment racing a close merges cleanly". It could read the effective rename setting and say so in its plan, and `doctor` could too.

Repro for (1), in a scratch repository:

```console
$ git config --local merge.directoryRenames conflict
$ nav install --merge-config -y     # replaces conflict with true, no mention of the old value
$ nav uninstall -y                  # then: git config --local --unset merge.directoryRenames
$ git config --local merge.directoryRenames; echo $?
1
```
