# Conformance fixtures

Golden repositories and expected results for [05 §5.4](../05-implementation.md).
Every implementation of this specification MUST pass this suite; it is the
mechanism by which the TypeScript reference implementation and the planned Rust
rewrite are kept in agreement.

Fixtures are plain browsable files. There are no nested `.git` directories and
no archives: a harness materializes a temporary git repository from the files
described here, runs one command, and compares the result.

## Layout

```
fixtures/
├── format/
│   ├── valid/<case>/      trees that MUST parse with no diagnostics
│   └── invalid/<case>/    trees and the diagnostics they MUST produce
├── operations/<verb>/<case>/
│                          (before-tree, command, after-tree, exit code, stdout)
└── merge/<case>/          the scenario table of 03 §3.3, replayable
```

Each case directory contains a `case.yaml` manifest plus the directories it
refers to.

## The manifest

```yaml
spec-version: 1
description: close an issue with a resolution, committing the change

# Starting state. Either a single tree committed as one commit ...
init:
  from: before                    # directory copied to the repository root
  message: "fixture: initial state"
  date: 2026-08-01T10:00:00Z

# ... or a scripted history, for cases that depend on commits and branches.
history:
  - id: base                      # name this commit for {{sha:base}}
    branch: main
    apply: history/00-base        # overlay copied over the working tree
    message: "feat: initial code"
    date: 2026-08-01T10:00:00Z
  - id: feat
    branch: feat/x
    from: base                    # branch off a named earlier commit
    apply: history/01-feat
    rm: [".navbook/issues/open/bqlybac0-login-timeout"]   # a move is rm + apply
    message: "docs(issue): close #bqlybac0"
    date: 2026-08-01T11:00:00Z

run:
  checkout: main                  # branch to be on when the command runs
  before: [["init"]]              # optional `nav` commands run as setup
  command: [issue, close, bqly, --resolution, fixed, --commit]
  git: [merge, feat/x]            # use instead of `command` to run raw git
  env:
    NAV_NOW: 2026-08-10T12:00:00Z
    NAV_IDS: t5kr1gq6

expect:
  exit: 0                         # default 0
  stdout: expected/stdout.txt     # exact comparison; "" means "no output"
  stderr: expected/stderr.txt     # optional
  stderr-contains: ["is ambiguous"]  # optional substring assertions
  tree: expected/tree             # exact `.navbook/` after the command
  commits:                        # commits created by the command, newest first
    - "docs(issue): close #bqlybac0\n\nCloses: bqlybac0\n"
```

`expect.tree` points at a directory that itself contains `.navbook/…`, so an
expected tree is a conforming Navbook tree you can browse directly. Empty status
directories appear as their `.gitkeep` files, exactly as `nav init` writes them.

## Determinism

The harness pins everything that could vary between machines:

| Setting | Value |
|---|---|
| `GIT_AUTHOR_NAME` / `GIT_COMMITTER_NAME` | `Nav Test` |
| `GIT_AUTHOR_EMAIL` / `GIT_COMMITTER_EMAIL` | `nav@test.invalid` |
| `GIT_AUTHOR_DATE` / `GIT_COMMITTER_DATE` | the step's `date`, default `2026-08-01T10:00:00Z` |
| `TZ`, `LC_ALL`, `LANG` | `UTC`, `C`, `C` |
| `NO_COLOR` | `1` — fixtures always compare uncolored output |
| `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM` | `/dev/null` — the developer's git config never leaks in |
| `HOME` | a fresh temporary directory |

Commit SHAs are still not written literally into expected files. They are
referenced by placeholder and substituted at comparison time:

| Placeholder | Expands to |
|---|---|
| `{{sha:<step-id>}}` | the commit created by that `history` step |
| `{{head}}` | `HEAD` after the command ran |

This keeps fixtures hand-editable: changing one overlay does not invalidate
every literal SHA downstream of it.

## Hooks an implementation under test MUST honor

Two environment variables replace the only two nondeterministic inputs a
Navbook implementation has. Supporting them is part of conforming to this suite.

| Variable | Meaning |
|---|---|
| `NAV_NOW` | An ISO 8601 timestamp used instead of the system clock for every timestamp the command writes (`created:`, comment filenames, `merged.date`). |
| `NAV_IDS` | A comma-separated list of IDs handed out, in order, instead of minting random ones. A command that needs more IDs than the list provides MUST fail loudly rather than fall back to randomness. |

Both are read once per invocation. When they are unset, behavior is the normal
random/clock behavior; nothing else about the implementation changes.

## Running the suite

```sh
npm test                                   # everything, against src/
NAV_BIN="node dist/cli/main.js" npm test   # against the built package
NAV_BIN=/path/to/rust/nav npm test         # against another implementation
```

`NAV_BIN` is split on whitespace; the first word is the executable.

## Diagnostics are compared by code, not by wording

`format/invalid` fixtures assert the check code (`D1`…`D10`), the level
(error/warning) and the path. Diagnostic *messages* are implementation-defined
and are never compared, so implementations may word them for their own users.
