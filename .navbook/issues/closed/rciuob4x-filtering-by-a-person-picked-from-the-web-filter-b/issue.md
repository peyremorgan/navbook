---
title: Filtering by a person picked from the web filter bar matches nothing
author: Claude <noreply@anthropic.com>
created: 2026-09-17T17:12:18Z
labels: [bug]
assignee: Claude <noreply@anthropic.com>
feature: [web, server]
resolution: fixed
---

Reported by Morgan on https://tracker.infra.brickcode.tech/: filtering the issue listing by an assignee picked from the filter bar shows nothing, although that person is assigned open issues (e.g. `/issues/epo4xcgf` on the deployment). The URL the filter bar produced:

```
/issues?status=open&assignee=Morgan+PEYRE+%3Cmorgan.peyre@brickcode.tech%3E
```

The filter bar offers people exactly as the `people` query returns them, `Name <email>`, and sends that value as `EntityFilter.assignees`. The query grammar only matches a bare address or a domain fragment, so the named form never matches anyone. `author:` and `reviewer:` in the same bar fail the same way.

## What it should do

A person query value (`assignee:`, `author:`, `reviewer:`, `awaiting:`) written as an RFC 5322 named address, `Name <email>`, matches by its address, exactly as the bare address does: the address is the identity key (spec 02 §2.4) and the name is only a label. A bare address and a domain fragment keep matching as they do today. The fix belongs in the grammar, not only in the web client, so a hand-typed or shared URL and `nav issue list 'assignee:Name <email>'` answer the same.
