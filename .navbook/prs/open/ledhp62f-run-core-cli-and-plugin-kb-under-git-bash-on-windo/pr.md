---
title: Run core, cli and plugin-kb under Git Bash on Windows
author: Claude <noreply@anthropic.com>
created: 2026-10-01T16:48:40Z
target: dev
source: fix/windows-mingw-tests
labels: [bug]
revisions:
  - head: 80fa189e8df598131ff356273403bf22cfa4b6a3
    base: cfec559c4be2be45970b41d24c91b09d8a6d6d9f
    date: 2026-10-01T16:48:40Z
---

The core, cli, plugin-kb and plugin-tests suites now pass under Git Bash on Windows. Five real bugs that only Windows exposed are fixed along the way, and the dev machine is set up to run them.

## Results on Windows 10, Git 2.56, Node 24.21

| Suite | Before | After |
|---|---|---|
| core | 37 failing of 933 | 923 pass, 10 skipped |
| cli | 22 failing of 416 | 418 pass, 5 skipped |
| plugin-kb | 6 failing, 37 cancelled of 145 | 145 pass |
| plugin-tests | not run | 120 pass |
| conformance | 128 pass | 128 pass |

Each skip names its reason:

- Unreadable files: Windows file modes cannot take away the owner's read access (5 tests).
- Symbolic links: they need Developer Mode, which this account does not have (4 tests).
- A shell script standing in for git: Windows will not launch one (5 tests).
- Ctrl-C to a process group: Windows has no process groups (1 test).

## Bugs fixed

- **`fileVersions` lost the version a merge committed.** Git 2.56 follows a rename through a merge without listing the merge. It now stops at the gap and resumes through the merge. This is not Windows-specific: it would show on any machine with a new git.
- **Early git exit reported as "spawnSync git EOF".** A git that exited before reading its input was reported that way on Windows, instead of with git's own error.
- **A grouped git command could not be stopped on Windows.** It now ends the process tree with `taskkill /T /F`. A job that Git Bash backgrounded is orphaned by its fork emulation and is out of reach of a tree kill; the README says so.
- **`NAVBOOK_PLUGIN_PATH` was split on `:`**, which cuts `C:\...` in two, so nav-server refused to start with kb on the path.
- **The CLI, on Windows:**
  - npm (`npm.cmd`) could not be launched, so every `nav plugin` verb failed. It now runs through `cmd.exe` with cross-spawn's quoting.
  - A `C:\...` path was read as a URL.
  - `$EDITOR` never received its file: it was quoted for sh but run by cmd. It now runs as git runs its editor: `sh -c '<editor> "$@"'`.

## Tests

- Core tests no longer read the machine's system gitconfig. They load a preload, `test/helpers/hermetic.ts`.
- Names a filesystem cannot hold go straight into the index.
- Paths are resolved, quoted and joined for the platform.
- New tests:
  - `spawning.test.ts` pins how npm and the editor are started on each platform.
  - An install of a folder named `odd & 100% (^caret!) 'q' plug` proves the cmd quoting end to end.

## Config

- **This repository:** `.gitattributes` keeps checkouts LF, with `*.cmd` as CRLF. Every tracked text file is already LF, so nothing is renormalized.
- **This machine:**
  - Node is on Git Bash's PATH through `~/.bashrc`, with `~/.bash_profile` sourcing it.
  - The pnpm shims came from `corepack enable --install-directory ~/bin`.
  - pnpm's `script-shell` is Git Bash.
  - The README has a *Developing on Windows* section covering the same steps.

## Not checked

- `pnpm check` (biome and the typecheck) was not run. The tool sandbox refused it. Every added line is within 100 columns, except one template literal that biome cannot break.
- The server and web suites were not run on Windows, beyond the plugin-path change they share.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
