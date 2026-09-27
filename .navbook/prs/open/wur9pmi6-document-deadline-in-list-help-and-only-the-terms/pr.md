---
title: "Document deadline: in list --help, and only the terms each noun accepts"
author: Claude <noreply@anthropic.com>
created: 2026-09-27T01:52:27Z
target: dev
source: fix/rz9rqg8h-list-help-deadline
reviewer: morgan.peyre@brickcode.tech
labels: [bug]
feature: cli
revisions:
  - head: 52841ac399b3e45c7f67cd575fc693c154e6a400
    base: 25f48ac623c5253b06e8209f9b684a024a4bd515
    date: 2026-09-27T01:52:27Z
  - head: 8dca42d0dfc808f748c099077f4ac4eaa807506b
    base: 2b8b0c574bdcdebc0b052d48d97570fb551d2e02
    date: 2026-09-27T02:23:12Z
---

Fixes #rz9rqg8h.

`nav {issue,pr} list --help` printed one hand-written block for both nouns. It had drifted from the parser in two ways:

- It left out `deadline:`, which the parser accepts, shell completion offers and spec 04 §4.3 documents.
- It listed `reviewer:`, `review:` and `awaiting:` on `nav issue list --help`, where the parser refuses all three with exit 1.

## Change

- **core:** `QUERY_TERMS` holds every keyed term, the noun that has it (`only`) and how repeated terms combine (`combines`). `KEYED_TERM` and the two noun refusals in `parseQuery` now derive from it. `queryTermsFor(kind)` returns the terms a noun accepts.
- **cli:** `queryHelp(kind)` renders the help for each noun from `queryTermsFor`. The wording lives in `TERM_HELP` and the column alignment is unchanged. The closing paragraph's OR and AND lists come from `combines`. `deadline` goes in the OR list, because `matchesDeadline` uses `.some`.
- **completion:** `complete.ts` drops its three hand-kept key lists and derives the keys from `queryTermsFor`.
- Spec 04's table is still written by hand. It already documents `deadline:`.

```console
$ nav issue list --help | sed -n '/^Query/,$p'
Query terms AND together. Terms:
  status:open|closed          entity status (path)
  …
  feature:SLUG                SLUG is among the entity's features (repeatable, ANDs)
  deadline:overdue|none       overdue: due before today (UTC), strictly;
                              none: no deadline at all
  WORD or "some phrase"       …
Same-key terms OR for single-valued fields (status, author, milestone, deadline)
and AND for multi-valued ones (label, assignee, feature).
```

`nav pr list --help` lists `status:open|closed|merged` plus the three review terms, and no `deadline:`.

## Tests

- **core `query.test.ts`:** for every `QUERY_TERMS` entry and both nouns, `parseQuery` accepts or refuses the term as `only` says, and `queryTermsFor` agrees. A second test checks that every listed key parses as a keyed term, not as free text.
- **cli `help.test.ts`:** for each noun, the help documents exactly the terms the parser accepts, and completion offers exactly the terms the help documents. A third test pins the closing paragraph. Against the old `program.ts` and `complete.ts`, three of these fail (`'reviewer:' is offered by the help for issues`).
- **Suites:** core 782, CLI 351, conformance 117 and server 375 all pass. Biome and `tsc` pass for core, CLI and the root.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
