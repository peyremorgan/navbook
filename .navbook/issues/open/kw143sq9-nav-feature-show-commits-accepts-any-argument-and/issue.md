---
title: nav feature show --commits accepts any argument and silently reports no history
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-20T12:37:28Z
labels: [bug, cli]
feature: [cli, features]
---

`--commits` is parsed to a `Number` deliberately, so that a bad value arrives intact rather than rounded — the comment on the sibling `--rank` option says why: "a value the command must refuse has to reach it intact rather than arrive silently rounded or defaulted."

Nothing ever refuses it. `cmdFeatureShow` does one test:

```ts
const limit = opts.commits ?? 10;
if (limit > 0) { … }
```

`NaN > 0` is `false`, so the whole "recent commits" section — header included — is dropped. A fractional value passes the test and reaches git as `-n 2.5`, which git refuses; `searchCommits` returns `[]` on a non-zero exit, so the section renders as empty.

## Repro

A repository with two commits touching the feature:

```console
$ nav feature show auth --commits 10 | tail -4

recent commits (2):
  0d35efdf  docs(issue): open #cwy1hbzp
  956ddaad  docs(feature): create auth

$ nav feature show auth --commits abc | tail -4
  none

issues and pull requests (1):
  #cwy1hbzp  open   Login times out
$ echo $?
0

$ nav feature show auth --commits 2.5 | tail -4
  #cwy1hbzp  open   Login times out

recent commits (0):
  none
$ echo $?
0
```

`--commits 2.5` is the worse of the two: `recent commits (0)` is not a missing answer but a wrong one, and a feature's timeline is what `nav feature show` exists for. Exit 0 means a script cannot tell either.

Every other numeric flag refuses:

```console
$ nav issue show cwy1 --depth abc
nav: --depth takes a whole number of levels          (exit 1)
$ nav issue open "x" --rank abc -m "b"
nav: --rank must be a number
$ nav id -n abc
nav: --count must be a positive integer
```

## What it should do

The validation the sibling commands already do:

```ts
const limit = opts.commits ?? 10;
if (!Number.isInteger(limit) || limit < 0) {
  fail("--commits takes a whole number of commits");
}
```

Zero stays valid — spec 04 §4.3 says "`--commits 0` omits the history" — so the test is `< 0` rather than `<= 0`. `fail` is already imported in the file.

Worth doing at the same time: `Pr.commits` on the server validates its own `limit` and `Feature.commits` does not, though `featureCommits` guards with `if (limit <= 0) return []`. That guard makes a bad limit harmless rather than correct.
