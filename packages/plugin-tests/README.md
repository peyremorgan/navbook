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
