# 04 — The documented plugin surface does not exist on this branch

**Tracked as:** `#sle5dwk9` — `nav issue show sle5dwk9`
**Severity:** Medium — the README's own worked example fails with "unknown
command", and five documents describe a package that is not in the workspace.
**Where:** the gap between `doc/` + `README.md` and `packages/`

## What is wrong

Five documents on `dev` describe plugins as a shipped feature:

| Document | What it claims |
|---|---|
| `README.md` "Plugins" | a console transcript of `nav plugin install` and `nav plugin list` |
| `README.md` "Contributing" | "The repository is a pnpm workspace of **five** packages … `packages/plugin-kb`" |
| `README.md` intro | "Features come from [`@navbook/plugin-kb`](doc/plugins.md), a plugin" |
| `doc/plugins.md` | the whole guide to using and writing one |
| `doc/spec/04-cli.md` §4.3 | "Plugins — `nav plugin <verb>`": `install`, `remove`, `update`, `list`, the store, the naming rules |
| `doc/spec/05-implementation.md` §5.2 | "A fifth, `@navbook/plugin-kb`, is the first plugin … holds the implementation of features and specifications … this codebase keeps them out of the core" |

None of it is implemented here.

```console
$ ls packages/
cli  core  server  web

$ grep -rn --include='*.ts' -e '"plugins"' -e 'plugin' packages/core/src packages/cli/src
(no matches)
```

## Reproduction

The README's first plugin instruction, run in a fresh repository:

```console
$ nav plugin install
error: unknown command 'plugin'

Usage: nav [options] [command]
...
Commands:
  init [options]       create the Navbook skeleton at the repository root
  id [options]         mint and print a fresh Navbook ID
  doctor [options]     check the tree against the specification
  install [options]    set up the git alias, merge config, pre-commit hook and completions
  uninstall [options]  remove what nav install set up
  issue                work with issues
  pr                   work with pull requests
  feature              work with features
$ echo $?
1
```

## Where the work actually is

This is a branch-state finding rather than a design fault. The implementation
exists in this clone, on another branch:

```console
$ git worktree list
/Users/…/navbook                            2ebc8ce [dev]
/Users/…/navbook/.claude/worktrees/plugins  74952b0 [worktree-plugins] locked

$ git stash list
stash@{0}: On dev: plugin leftovers on dev, superseded by worktree-plugins (2026-09-20)
```

What landed on `dev` is the *documentation* — commit `780c315`,
`doc(spec): reserve extension namespaces and specify plugins` — ahead of the
code it describes. The audit records it because `dev` is what a reader of this
repository sees, and on `dev` the README is wrong.

Two consequences follow from the split that are worth naming separately:

**Features are in core, and spec 05 §5.2 says they are not.** `specs/`,
`feature.md` and the whole `nav feature` family live in `@navbook/core` and
`@navbook/cli` (`core/src/ops/feature.ts`, `cli/src/commands/feature.ts`). §5.2
states that `@navbook/plugin-kb` "holds the implementation of features and
specifications … the format keeps their definition, this codebase keeps them out
of the core". On `dev` the core keeps both. Spec 02 §2.12's closing paragraph
makes the same claim: "The reference implementation has moved their
*implementation* into an extension without moving their definition ([05 §5.2])."

**Doctor's extension checks are unreachable.** Spec 04 §4.3 reserves
`X-<short>-<n>` for checks an extension adds, "outside the `D` series … so that
a future `D16` can never collide with something already shipped". `Check` is a
closed union of `D1`–`D15` (`core/src/core/validate.ts:47-64`), which is correct
for today and will need widening when the surface lands.

## Suggested fix

Either direction is defensible; what is not defensible is leaving them apart.

**If the plugin work is close to landing**, land the documentation with it
rather than ahead of it. The specification is a different case from the README:
reserving the namespaces in §2.12 *before* anything uses them is exactly right
and is what lets a tool preserve data it cannot read. But spec 04 §4.3's
`nav plugin` section and spec 05 §5.2's "fifth package" describe a reference
implementation rather than a format, and those are claims about this repository.

**If it is further out**, mark the three tool-facing sections as reserved the
way `doc/spec/06-future.md` marks everything in it — that file's convention of
saying "(built)" against §6.3 is the precedent, and the inverse marker would
work as well. The README's Plugins section is the one that most needs it: it is
a transcript of a command that does not exist, in the file people read first.

## Related

Finding [03](03-d15-ignores-the-plugins-declaration.md) is the *format* half of
the same split and is worth fixing on `dev` regardless of when the tooling
lands: D15 is a check a conforming tree is judged by, not a plugin feature.
