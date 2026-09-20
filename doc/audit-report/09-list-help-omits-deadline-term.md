# 09 — `nav {issue,pr} list --help` omits the `deadline:` query term

**Tracked as:** `#rz9rqg8h` — `nav issue show rz9rqg8h`
**Severity:** Low — a documented, implemented and tab-completable term that the
one place people look for it does not mention.
**Where:** [`packages/cli/src/program.ts:62-76`](../../packages/cli/src/program.ts#L62-L76)

## What is wrong

`QUERY_HELP` is the block appended to both `list` commands' help. It lists nine
terms and leaves one out:

```
Query terms AND together. Terms:
  status:open|closed|merged   entity status (path); 'merged' is PR-only
  label:L                     L is among the entity's labels (repeatable, ANDs)
  assignee:EMAIL              assignee address, or a fragment of its domain
  author:EMAIL                author address, same matching
  milestone:M                 exact milestone
  feature:SLUG                SLUG is among the entity's features (repeatable, ANDs)
  reviewer:EMAIL              asked to review it; PRs only, same matching
  review:DECISION             pending, approved or changes-requested; PRs only
  awaiting:EMAIL              asked to review it and has not yet; PRs only
  WORD or "some phrase"       case-insensitive substring of the title,
                              description, or any comment body
Same-key terms OR for single-valued fields (status, author, milestone, review)
and AND for multi-valued ones (label, assignee, feature, reviewer, awaiting).
The default query is status:open.
```

No `deadline:`. The closing paragraph also leaves it out of both lists, though
`matchesDeadline` (`core/src/core/query.ts:251-261`) ORs its terms and the
paragraph is otherwise exhaustive.

## Everything else already has it

Spec 04 §4.3's grammar table:

> | `deadline:overdue\|none` | `overdue`: a `deadline` strictly before today;
> `none`: no `deadline` at all. Issues only |

The parser: `KEYED_TERM` includes `deadline`, and `DEADLINE_TERMS` is
`["overdue", "none"]` (`query.ts:43-51`).

Shell completion offers it, and deliberately — `complete.ts:22-23`:

```ts
/** And the one only an issue has (spec 02 §2.5). */
const ISSUE_QUERY_KEYS = ["deadline:"];
```

The README's "Query syntax" section has it:

> `status:`, `label:`, `assignee:`, `author:`, `milestone:`, `feature:`,
> `deadline:overdue|none`, and bare words …

## Reproduction

```console
$ nav issue list --help | grep -c deadline:
0

$ nav issue list deadline:none
ID         STATUS  TITLE
#cwy1hbzp  open    Login times out

$ nav __complete issue list | grep deadline
deadline:
```

The term works and is completed; only the help is silent about it.

## Why it matters

`nav issue list --help` is the reference for the query grammar at the point of
use, and `--sort deadline` appears three lines above it — so the help
simultaneously tells somebody that deadlines are a thing you can sort by and
implies they are not a thing you can filter by. That is the specific shape of
wrong that costs somebody a search through the spec.

`deadline:` is also the newest term in the grammar, which is how it came to be
the one that was missed, and is the argument for making the list harder to
forget rather than just adding a line.

## Suggested fix

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

Worth considering as well: the help is one string in `program.ts` while the
grammar is three constants in `core/src/core/query.ts` (`KEYED_TERM`,
`PR_ONLY_TERMS`, `ISSUE_ONLY_TERMS`) and a fourth list in
`cli/src/commands/complete.ts`. Four copies of one vocabulary is how the fifth
one gets forgotten. Building the help text from the same constants the parser
and the completion use would make this class of drift impossible, and it is a
small change — the descriptions are the only part that has to be written by
hand.

## Test gap

`packages/cli/test/cli/help.test.ts` asserts the shape of the help output. A
case that every term `KEYED_TERM` accepts appears in `QUERY_HELP` would have
caught this and would catch the next one.
