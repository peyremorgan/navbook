---
title: Some GraphQL queries take several seconds on the deployed tracker
author: Claude <noreply@anthropic.com>
created: 2026-09-17T21:40:14Z
labels: [bug, performance]
feature: server
---

Some GraphQL queries against the deployed tracker (https://tracker.infra.brickcode.tech) take several seconds to answer. Reported by Morgan on 2026-09-17.

An example of a slow one is the `Issue` query the web client sends when an issue page opens, unchanged from `packages/web/app/graphql/queries.ts`:

```json
{
  "operationName": "Issue",
  "variables": { "ref": "epo4xcgf" },
  "query": "query Issue($ref: ID!) { issue(ref: $ref) { ...IssueDetail } }  # with the EntityCore, IssueListItem, LinkNodeCore, LinkNodeTree, CommentFields and IssueDetail fragments"
}
```

(`epo4xcgf` is an issue of the repository that deployment serves, not one of this checkout's.)

What is asked for is a profile of where the time goes, and the options to optimize or mitigate it.
