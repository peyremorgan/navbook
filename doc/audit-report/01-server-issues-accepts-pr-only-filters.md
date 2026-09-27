# 01 — The API's `issues` query accepts pull-request-only filter terms

**Tracked as:** `#zlr44nen` — `nav issue show zlr44nen`
**Severity:** High — silently wrong results, no error, no warning.
**Where:** [`packages/server/src/resolvers/query.ts:44-48`](../../packages/server/src/resolvers/query.ts#L44-L48)
**Also implicated:** [`packages/server/src/resolvers/map.ts:111-127`](../../packages/server/src/resolvers/map.ts#L111-L127)

## What is wrong

`EntityFilter` carries three terms that describe something only a pull request
has — `reviewers`, `reviews`, `awaiting` — and one that describes something only
an issue has, `deadline`. The `prs` resolver rejects `deadline`. The `issues`
resolver rejects nothing.

The asymmetry is visible in the file itself. `prs` guards:

```ts
// packages/server/src/resolvers/query.ts:56-58
if (args.filter?.deadline?.length) {
  throw invalidInput("'deadline' describes an issue; pull requests have no deadline");
}
```

`issues` is a single line with no guard at all:

```ts
// packages/server/src/resolvers/query.ts:44-45
issues: (_parent, args, ctx) =>
  run(() => ctx.sync.read(() => listEntities(ctx.ws, "issue", toQuery(args.filter, today(ctx))))),
```

`toQuery` copies all three terms into the core `Query` unconditionally
(`map.ts:121-123`), and `matchesQuery` then evaluates them against an issue.

## Why it is wrong

Three documents say it should be refused.

**Spec 04 §4.3, the query grammar**, is explicit and uses a MUST:

> `reviewer`, `review` and `awaiting` describe something only a pull request
> has, so `nav issue list` MUST reject them the way it rejects `status:merged`,
> rather than matching nothing.

**The schema's own documentation** claims the behaviour that is missing —
`schema.graphql:375-381`:

> This and the two below describe something only a pull request has, so
> `issues` rejects them rather than matching nothing.

**The CLI does reject them.** `parseQuery` refuses the term at parse time
(`packages/core/src/core/query.ts:101-103`), so the two front ends over one
grammar disagree — which is exactly what spec 06 §6.3's "a reader of the API and
a reader of `nav --json` are looking at the same thing" is meant to prevent.

## What actually happens

`reviews` is the damaging one. `reviewSummary` on an issue finds no revisions
and no reviewers, so `decide([])` returns `pending` — and the filter matches.

```
$ node probe.ts
issues matched by review:pending  -> true
issues matched by review:approved -> false
issues matched by awaiting        -> false
CLI parseQuery(issue,'review:pending') -> ERROR: 'review:' describes a pull request; issues have no reviews
```

So `issues(filter: { reviews: [PENDING] })` returns **every open issue in the
repository**, presented as the answer to a question about reviews. A client
building a "needs review" view from it gets a plausible, complete and entirely
meaningless list.

`awaiting` and `reviewers` match nothing, which is the failure spec 04 names.
But `reviewers` is worse than "nothing": `reviewer:` is not an issue-only key
that `validateIssue` rejects, so an issue that carries one by hand — unknown
keys are preserved by §2.4 — is matched:

```
doctor problems for an issue carrying `reviewer:` -> []
issues(filter:{reviewers:['zed@example.com']}) matches it -> true
```

The answer to a PR-only filter therefore depends on whether somebody once
hand-edited a key into an issue file.

## Reproduction

```ts
import { parseTree, matchesQuery, emptyQuery } from "@navbook/core";

const repo = parseTree(new Map([[
  "issues/open/ab12cd34-login/issue.md",
  "---\ntitle: Login broken\nauthor: a@example.com\ncreated: 2026-01-01T00:00:00Z\n---\n\nBody.\n",
]]));

const q = emptyQuery();
q.reviews = ["pending"];
matchesQuery(q, repo.issues[0]!);   // true — this is `issues(filter:{reviews:[PENDING]})`
```

Over HTTP: `query { issues(filter: { reviews: [PENDING] }) { id title } }`
against any repository returns the whole issue list.

## Suggested fix

Mirror the guard `prs` already has, in the same place and the same words:

```ts
issues: (_parent, args, ctx) =>
  run(() =>
    ctx.sync.read(() => {
      // The mirror of what `prs` refuses: a term describing something this
      // noun does not have is an error, not a filter that matches nothing
      // (spec 04 §4.3).
      for (const [key, label] of [
        ["reviewers", "reviewer"],
        ["reviews", "review"],
        ["awaiting", "awaiting"],
      ] as const) {
        if (args.filter?.[key]?.length) {
          throw invalidInput(`'${label}' describes a pull request; issues have no reviews`);
        }
      }
      return listEntities(ctx.ws, "issue", toQuery(args.filter, today(ctx)));
    }),
  ),
```

An alternative worth weighing: move the rejection into `toQuery`, which already
knows the entity kind is implied by the caller, so no future resolver can forget
it. That is the shape `parseQuery` uses in core, and it is why the CLI has never
had this bug.

## Test gap

`packages/server/test/server/read.test.ts:346` asserts the `prs`/`deadline`
refusal. There is no counterpart for `issues`. Adding the three cases beside it
is the whole regression test:

```ts
it("refuses the review filters on issues, which have no reviews", async () => {
  for (const term of ['reviewers: ["a@b.com"]', "reviews: [PENDING]", 'awaiting: ["a@b.com"]']) {
    const response = await h.gql(`query { issues(filter: { ${term} }) { id } }`);
    assert.equal(errorCode(response), "INVALID_INPUT");
    assert.match(response.errors[0]?.message ?? "", /describes a pull request/);
  }
});
```

`errorCode` is the helper the neighbouring `prs` case already uses.
