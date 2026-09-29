# @navbook/plugin-tests

Manual **test plans** kept in the repository, and the **runs** that record
executing one: standalone, or attached to a pull request, where they travel
with it through review and merge.

A plan is a Markdown file of steps, each an action and the result it should
produce. A run records, step by step, what the tester actually observed,
against a commit or a version, as far as they got. What a run concluded is
never stored: it is read off the steps it records, so it cannot disagree with
them.

```
.navbook/
├── tests/
│   └── login-flow/
│       ├── plan.md
│       └── runs/
│           └── 2026-09-20T101500Z-r7k2m9x1.md
└── prs/open/dk3mp2x9-auth-refactor/
    ├── pr.md
    └── tests/
        └── 2026-09-21T090000Z-t3w8p1q4.md
```

```console
$ nav test open "Login flow" --slug login --commit     # $EDITOR opens on a skeleton
Created .navbook/tests/login/  (login)

$ nav test run login --pr dk3m --commit                  # on the pull request's branch
Started run t3w8p1q4 of 'login'  .navbook/prs/open/dk3mp2x9-auth-refactor/tests/…
Step 1 of 2: Open the login page
  Actions:
    Browse to `/login`.
  Expected:
    The form shows.
[p]assed [f]ailed [b]locked [s]kipped [q]uit > p
Step 2 of 2: Sign in
…
[p]assed [f]ailed [b]locked [s]kipped [q]uit > f
What happened? (Enter to skip, 'e' for $EDITOR) > A blank page.
Every step is recorded. Finish the run? [Y/n]

2 of 2 steps recorded: failed
Committed docs(tests): run login t3w8p1q4 on #dk3mp2x9

$ nav pr list tested:failed
$ nav pr show dk3m                                       # a "test runs" section
```

Every answer is written to the run file as it is given, so a run left halfway
is picked up with `nav test resume`. Scripts and agents use the verbs one at a
time instead:

| Command | What it does |
|---|---|
| `nav test open <title>` | Create a plan (`-m` for the body, else `$EDITOR`) |
| `nav test list`, `nav test show <plan>` | Plans, their steps, their recent runs |
| `nav test edit <plan>` | Edit `plan.md` in `$EDITOR` |
| `nav test run <plan> [--pr ID] [--at REV] [--version V] [--env TEXT]` | Start a run, and walk its steps when there is a terminal |
| `nav test record <run> <step> <status> [-m ACTUAL]` | Record one step |
| `nav test resume <run>`, `nav test finish <run>` | Carry on with a run, or say it is done |
| `nav test runs [plan] [plan:… pr:… outcome:…] [--all-refs]` | List runs, newest first |
| `nav test show <run>` | A run beside every step of the plan it followed |
| `nav test attach <run> <file>… [--step N]` | Copy screenshots or logs beside a run, and link them |

A run attached to a pull request is written on the pull request's branch, the
way a review is; from anywhere else it is refused with the branch to check out.

[`doc/spec.md`](doc/spec.md) is this plugin's specification: the files, their
grammar, how an outcome is derived, and what a tool without the plugin does
with them — which is to preserve them untouched.

## Installing it

```sh
nav plugin install @navbook/plugin-tests
```

And in the repository's `.navbook/navbook.json`, so every clone knows the tree
has test plans in it:

```json
{
  "version": 1,
  "plugins": {
    "@navbook/plugin-tests": {}
  }
}
```

## Without it installed

A `nav` without this plugin preserves `tests/` and the runs inside pull request
directories and interprets neither. Closing, merging and deleting a pull
request carry its runs with it, `doctor` says nothing about them, and `nav`
says once that `tests/` belongs to this plugin.
