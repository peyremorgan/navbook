---
title: nav plugin and @navbook/plugin-kb are documented in five places and do not exist on dev
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-20T12:37:00Z
labels: [bug]
feature: plugins
---

Five documents on `dev` describe plugins as shipped, and nothing on `dev` implements them.

| Document | What it claims |
|---|---|
| `README.md` "Plugins" | a console transcript of `nav plugin install` and `nav plugin list` |
| `README.md` "Contributing" | "a pnpm workspace of **five** packages … `packages/plugin-kb`" |
| `README.md` intro | "Features come from `@navbook/plugin-kb`, a plugin" |
| `doc/plugins.md` | the whole guide to using and writing one |
| `doc/spec/04-cli.md` §4.3 | "Plugins — `nav plugin <verb>`": `install`, `remove`, `update`, `list`, the store, the naming rules |
| `doc/spec/05-implementation.md` §5.2 | "A fifth, `@navbook/plugin-kb` … holds the implementation of features and specifications … this codebase keeps them out of the core" |

```console
$ ls packages/
cli  core  server  web

$ grep -rn --include='*.ts' -e '"plugins"' -e 'plugin' packages/core/src packages/cli/src
(no matches)

$ nav plugin install
error: unknown command 'plugin'
$ echo $?
1
```

The README's first plugin instruction fails for anyone who follows it.

Two consequences follow from the same split and are worth naming separately:

- **Features are in core, and spec 05 §5.2 says they are not.** `specs/`, `feature.md` and the whole `nav feature` family live in `@navbook/core` and `@navbook/cli`. §5.2 states that `@navbook/plugin-kb` holds them and "this codebase keeps them out of the core"; spec 02 §2.12's closing paragraph makes the same claim.
- **Doctor's extension checks are unreachable.** Spec 04 §4.3 reserves `X-<short>-<n>` for checks an extension adds. `Check` is a closed union of `D1`–`D15`, which is correct for today and will need widening.

## What it should do

Either direction is defensible; what is not is leaving them apart.

If the work behind #ywz73dxu is close to landing, land the documentation with it rather than ahead of it. The specification is a different case from the README: reserving the namespaces in spec 02 §2.12 *before* anything uses them is exactly right, and is what lets a tool preserve data it cannot read. But spec 04 §4.3's `nav plugin` section and spec 05 §5.2's "fifth package" describe this repository rather than the format, and those are claims about code that is not here.

If it is further out, mark the three tool-facing sections as reserved the way `doc/spec/06-future.md` marks everything in it — that file's convention of saying "(built)" against §6.3 is the precedent, and the inverse marker would read the same way. The README's Plugins section needs it most: it is a transcript of a command that does not exist, in the file people read first.
