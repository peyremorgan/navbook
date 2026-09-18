---
title: nav doctor ignores the marker's version, so a tree from a newer Navbook reads as sound
author: Claude <noreply@anthropic.com>
created: 2026-09-18T08:42:43Z
assignee: Claude <noreply@anthropic.com>
labels: [bug]
feature: [cli, doctor, format]
---

Reported by Morgan, about to approve a pull request from the main checkout on `dev`:

```console
$ nav pr show zno8oe2q
nav: no pull request matches 'zno8oe2q'
```

The pull request exists. It is open, it is on `feat/sfbidn0t-pr-tabs`, and the same `nav` finds it one command earlier:

`nav pr list --all-refs`, run a moment earlier in the same checkout with the same binary, prints it: `#zno8oe2q`, open, target `dev`, found on `feat/sfbidn0t-pr-tabs`.

## What it actually was

The `nav` on that PATH is **0.2.0**, installed on 15 September; `latest` on npm is 0.3.0 and this workspace is 0.3.0.

```console
$ nav --version                            # /home/deck/bin/nav → @navbook/cli 0.2.0
0.2.0
$ node packages/cli/src/main.ts --version  # this workspace
0.3.0
$ npm view @navbook/cli version
0.3.0
```

So this is issue #t4mwvm2j, fixed by #z3j95v3e and released in v0.3.0 (#nq2m4evc), met again by a CLI that predates the fix. Running the workspace's own 0.3.0 from `dev`, every part of it behaves:

`pr show` prints the pull request under the line *read from 'feat/sfbidn0t-pr-tabs'; this checkout does not hold `#zno8oe2q`*. `pr review --approve` refuses with

> nav: `#zno8oe2q` is on 'feat/sfbidn0t-pr-tabs', which is not checked out here
> a pull request is written on its source branch, beside the files it proposes to merge
> 'feat/sfbidn0t-pr-tabs' is checked out in /home/deck/.cache/navbook-worktrees/sfbidn0t; run the command there

That last line is right down to naming the worktree, which is what #t4mwvm2j asked for. `npm install -g @navbook/cli` is the whole remedy for the report.

## The defect worth fixing

Nothing anywhere notices that a `nav` is older than the world it is reading. That cannot be solved in general offline — there is no server to ask, and a repository does not record which tool wrote it. But the format does carry one version, and this is the one place Navbook can say something:

> `navbook.json` … MUST be a JSON object. This revision defines two keys, `version`, whose value **MUST be the integer `1`**, and `review`, the review policy below
> — [spec 02 §2.10](doc/spec/02-data-model.md)

Check D15 reads that marker and reports a malformed `review`. It never looks at `version`. Every one of these passes:

```console
$ printf '{ "version": %s }\n' 2 > .navbook/navbook.json && nav doctor | tail -1
0 errors, 7 warnings          # and the same for 99, "banana", null, and 1.5
```

So a tree written by a future Navbook — the exact situation this report is an instance of — is read by today's `nav` and pronounced sound. The one signal the format offers is on the floor.

## What it should do

- D15 reports a `version` that is present and is not the integer `1`, as it already reports a malformed `review`: a fault in the marker rather than in the tree it marks (§2.10), so the entities stay readable and the listing still runs.
- The two cases read differently and should say so. An integer above `1` means the tree is newer than this tool, and the sentence a person needs is *update `nav`*. Anything else — a string, `null`, a non-integer — is a malformed marker.
- A **missing** `version` stays silent. §2.10 requires the value when the key is there, never the key, and a repository predating the marker is explicitly still conforming.

## Also found

Issue #t4mwvm2j is still in `issues/open/` although it is fixed and released. All four of the commands it lists now work or refuse with a useful precondition, verified above. Its close never travelled with #z3j95v3e.
