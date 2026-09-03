---
title: Create a web UI for Navbook leveraging the GraphQL API
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-02T16:06:02Z
labels: [enhancement]
assignee: admin@brickcode.tech
---

Build a web-based UI for Navbook (issues/PRs) that consumes the @navbook/server GraphQL API instead of talking to the git-native store directly.

Scope:
- New client app (e.g. packages/web) that queries/mutates via the GraphQL schema exposed by @navbook/server.
- Core views: issue/PR list & filtering, issue/PR detail with comments, create/edit flows, label/assignee/milestone management.
- Reuse @navbook/server's GraphQL types/resolvers as the single source of truth; no direct filesystem access from the UI.

Out of scope (for now): auth/multi-user permissions beyond what the server already provides, real-time subscriptions.
