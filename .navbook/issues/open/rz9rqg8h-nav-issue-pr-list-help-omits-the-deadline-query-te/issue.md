---
title: "nav {issue,pr} list --help omits the deadline: query term"
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-20T12:39:37Z
labels: [bug, cli]
feature: cli
---

`QUERY_HELP` is the block appended to both `list` commands' help. It lists nine terms and leaves out `deadline:`, and the closing paragraph leaves it out of both its lists too.

```console
$ nav issue list --help | grep -c deadline:
0

$ nav issue list deadline:none
ID         STATUS  TITLE
#…        open    Login times out

$ nav __complete issue list | grep deadline
deadline:
```

The term works and is completed; only the help is silent about it.

Everything else has it. Spec 04 §4.3's grammar table: "`deadline:overdue|none` — `overdue`: a `deadline` strictly before today; `none`: no `deadline` at all. Issues only". The parser: `KEYED_TERM` includes `deadline` and `DEADLINE_TERMS` is `["overdue", "none"]`. The completion backend has it deliberately — `/** And the one only an issue has (spec 02 §2.5). */ const ISSUE_QUERY_KEYS = ["deadline:"]`. The README's "Query syntax" section has it.

## Why it matters

`--help` is the reference for the query grammar at the point of use, and `--sort <order>` — whose values include `deadline` — appears three lines above it. So the help simultaneously says deadlines are something you can sort by and implies they are not something you can filter by, which is the specific shape of wrong that costs somebody a search through the spec.

## What it should do

Add the row and mend the closing paragraph:

```diff
   awaiting:EMAIL              asked to review it and has not yet; PRs only
+  deadline:overdue|none       overdue: due before today (UTC), strictly;
+                              none: no deadline at all. Issues only
   WORD or "some phrase"       case-insensitive substring of the title,
                               description, or any comment body
-Same-key terms OR for single-valued fields (status, author, milestone, review)
+Same-key terms OR for single-valued fields (status, author, milestone, review,
+deadline)
 and AND for multi-valued ones (label, assignee, feature, reviewer, awaiting).
```
