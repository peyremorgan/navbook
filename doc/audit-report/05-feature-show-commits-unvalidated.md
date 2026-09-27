# 05 — `nav feature show --commits` accepts any argument and reports no history

**Tracked as:** `#kw143sq9` — `nav issue show kw143sq9`
**Severity:** Medium — wrong output with exit 0, and it is the one numeric flag
in the CLI that does not refuse a bad value.
**Where:** [`packages/cli/src/commands/feature.ts:176-184`](../../packages/cli/src/commands/feature.ts#L176-L184),
[`packages/cli/src/program.ts:259-261`](../../packages/cli/src/program.ts#L259-L261)

## What is wrong

The option is parsed to a `Number` deliberately, so that a bad value arrives
intact rather than rounded:

```ts
// packages/cli/src/program.ts:259-261
.option("--commits <n>", "recent commits to list (default 10)", (value) =>
  value.trim() === "" ? Number.NaN : Number(value),
)
```

The comment on the sibling `--rank` option says why that shape was chosen:

> Number rather than parseInt, and blank rather than 0, for the reason `--depth`
> does it: a value the command must refuse has to reach it intact rather than
> arrive silently rounded or defaulted.

But nothing ever refuses it. The command does one test, and `NaN` fails it
quietly:

```ts
// packages/cli/src/commands/feature.ts:176-177
const limit = opts.commits ?? 10;
if (limit > 0) {
  const commits = featureCommits(ctx, feature, attached, { limit });
  ...
}
```

`NaN > 0` is `false`, so the whole "recent commits" section — header included —
is dropped. A fractional value passes the test and then reaches git as
`-n 2.5`, which git refuses; `searchCommits` returns `[]` on a non-zero exit
(`core/src/git/history.ts:166-168`), so the section renders as empty.

## Reproduction

A repository with two commits touching a feature:

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

`--commits abc` prints no commits section at all. `--commits 2.5` prints
`recent commits (0): none` — a positive assertion that nothing has touched the
feature, when two commits have.

For contrast, every other numeric flag refuses:

```console
$ nav issue show cwy1 --depth abc
nav: --depth takes a whole number of levels
$ echo $?
1

$ nav issue open "x" --rank abc -m "b"
nav: --rank must be a number

$ nav id -n abc
nav: --count must be a positive integer
```

## Why it matters

`recent commits (0)` is not a missing answer, it is a wrong one. A feature's
timeline is the thing `nav feature show` exists for — spec 04 §4.3 gives it a
paragraph of its own — and "nothing has touched this" is a conclusion somebody
might act on. Exit 0 means a script cannot tell either.

The fractional case is the worse of the two: a typo like `--commits 1O` (letter
O) produces `NaN` and a visibly missing section, but `--commits 2.5` produces a
section that looks answered.

## Suggested fix

The validation the sibling commands already do, in the same words:

```ts
// packages/cli/src/commands/feature.ts
const limit = opts.commits ?? 10;
if (!Number.isInteger(limit) || limit < 0) {
  fail("--commits takes a whole number of commits");
}
if (limit > 0) { … }
```

`fail` is already imported in this file. Zero stays valid — spec 04 §4.3 says
"`--commits 0` omits the history" — so the test is `< 0` rather than `<= 0`.

Worth doing at the same time: `Query.commits` on the server validates its own
`limit` (`server/src/resolvers/entity.ts:141-143`) and `Feature.commits` does
not, though `featureCommits` guards with `if (limit <= 0) return []`
(`core/src/ops/feature.ts:109`). A negative or fractional `limit` from a GraphQL
`Int!` is possible and would take the same path; the guard in core makes it
harmless rather than correct.

## Test gap

`packages/cli/test/cli/feature.test.ts` covers `--commits 0` and a valid count.
A case asserting exit 1 for a non-integer would pin it, and would sit beside the
existing `--depth` case in `issue.test.ts`.
