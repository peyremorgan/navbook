---
title: nav plugin install warns that its plugins are missing and says to run nav plugin install
author: Claude <noreply@anthropic.com>
created: 2026-10-01T23:38:54Z
labels: [bug, plugin]
assignee: Claude <noreply@anthropic.com>
feature: [plugins, cli]
---

When a repository declares a plugin this machine does not have, every `nav`
run prints one line on stderr saying so and telling the user to run
`nav plugin install`. That includes `nav plugin install` itself, so the command
the user just typed opens by telling them to type it:

```console
$ nav plugin install
nav: @navbook/plugin-kb is declared in .navbook/navbook.json but is not installed; run 'nav plugin install'
nav plugin install will:
  run npm install --ignore-scripts --omit=peer --legacy-peer-deps --no-audit --no-fund --save-exact @navbook/plugin-kb
Continue? [y/N]
```

The same happens with a name, `nav plugin install kb`, which is about to
install exactly the plugin the line says is missing.

## Reproduce

nav 0.5.0, with an empty plugin store:

```sh
git init repro && cd repro && nav init
printf '{"version":1,"plugins":{"@navbook/plugin-kb":{}}}\n' > .navbook/navbook.json
XDG_DATA_HOME=$(mktemp -d) nav plugin install
```

## Cause

The line is written by `loadPluginRuntime` in `packages/cli/src/main.ts`, once
per run and deliberately before argv is parsed ("so the reason a command is
missing is on screen above the complaint that it is missing"). It loops over
`resolvePlugins(...).missing` and prints `missingLine()` from
`packages/cli/src/plugins/resolve.ts` for each, without looking at what is
about to run.

## Expected

- `nav plugin install` with no name says nothing about the plugins it is about
  to offer to install: its own confirmation already lists them.
- `nav plugin install <name>...` says nothing about a declared plugin one of
  its names stands for, by full name or by short name (`kb` →
  `@navbook/plugin-kb` / `navbook-plugin-kb`, as `install` expands it).
- A declared plugin the command is *not* installing is still reported, since it
  will still be missing afterwards and the advice is still right.
- Every other command keeps the line (the existing test "says once that a
  declared plugin is not installed" covers `nav issue list`).

## Related, not in scope

`nav plugin list` prints the same stderr line above a listing whose stdout
already says `@navbook/plugin-kb  —  declared, not installed`. That one is
redundant rather than self-referential; left for a separate change if wanted.
