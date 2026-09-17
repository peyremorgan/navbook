---
title: Match a person query written as a named address
author: Claude <noreply@anthropic.com>
created: 2026-09-17T17:16:24Z
target: dev
source: fix/rciuob4x-named-person-query
reviewer: morgan.peyre@brickcode.tech
labels: [bug]
feature: [web, server]
revisions:
  - head: 39f18a03765bd410d8fa56e50564b80d4f815d33
    base: cec5460d224676d9c646ce364b19651f3f06caac
    date: 2026-09-17T17:16:24Z
---

Fixes #rciuob4x.

Filtering the web client's issue or PR listing by a person picked from the filter bar listed nothing. The menus offer people as the `people` query names them (`Name <email>`). `personMatches` parsed the field it compared against but not the query value, so a named value could never equal an address, and the `@` in it ruled out the domain-fragment rule too.

## Change

- `packages/core/src/core/person.ts`: `personMatches` parses the query value with `parsePerson` and compares addresses. A bare address and a domain fragment behave as before. This covers `assignee:`, `author:`, `reviewer:` and `awaiting:` for the CLI and the API together, so a hand-typed or shared URL works too.
- `doc/spec/04-cli.md`: the grammar table says a named address matches by its address alone.

## Tests

- core: `personMatches` with named values (same address, different name, different address); `assignee:` and `reviewer:` terms written as named addresses.
- server: `read.test.ts` filters `issues` by the exact strings `people` returns. It fails on `dev` and passes here.
- core 701/701, server 330/330, conformance 115/115; `tsc --noEmit` and `biome check` are clean. I didn't run the CLI and web suites: the web client is unchanged, and the CLI goes through the same core function, which I checked by hand:

```console
$ node packages/cli/src/main.ts issue list 'assignee:Claude <noreply@anthropic.com>'
#rciuob4x  open  Filtering by a person picked from the web filter bar matches nothing  ...
#icroff4l  open  Signing out of the web client leaves the identity provider session ... 
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
