---
title: Link issue and PR references written in prose
author: Claude <noreply@anthropic.com>
created: 2026-09-17T21:23:02Z
target: dev
source: fix/ll18jzkz-prose-reference-links
reviewer: morgan.peyre@brickcode.tech
labels: [enhancement]
feature: web
revisions:
  - head: 06a83269057cba89e4279b0bfd1f1cf49e91ed5f
    base: 5541299270b0e1c6607b699c0e789fbd886c2289
    date: 2026-09-17T21:23:02Z
  - head: b88956138bcb8aba1e665c4b2744bcf86ade3547
    base: c93e558dd6815b3566d78e8a1a4a477c34b5c392
    date: 2026-09-17T22:04:34Z
merged:
  date: 2026-09-17T22:06:10Z
  by: Claude <noreply@anthropic.com>
---

Closes #ll18jzkz.

A `#id` written in an issue body, a pull request's description or a comment
is now a link to what it names. It was plain text, so following one meant
selecting eight characters, opening a listing and pasting them into the
filter — while the same reference held in frontmatter was already a link.

## How it resolves

An id says nothing about its kind: issues and pull requests are minted from
one space of 8 random characters, so an anchor built from the sentence alone
cannot know whether it wants `/issues/:ref` or `/prs/:ref`. It points at a new
`/ref/:id`, which asks the server and redirects with `replace`, so the page
somebody was reading stays one Back away.

That is usually **one** request, not two. `issue(ref:)` on a pull request's id
answers `WRONG_KIND` — the server naming the kind rather than refusing — so
the fallback query is only reached on `NOT_FOUND`, which is the pull request
living on a branch the server has fetched but is not standing on. Either way
the entity is in Apollo's cache before the page it belongs to renders, so the
redirect costs a render and not a round trip.

The alternative was a `reference(ref:)` query on the server. It is not worth a
schema change: the API already answers this, and the client would still need
to find the references in the text to know what to wrap.

## What else had to move

- **Clicks.** The rendered markup is inserted as a string, so a reference is a
  plain `<a href>` and nothing makes it a `NuxtLink`. Left alone it reloads the
  whole single-page app to move between two pages it already holds, so
  `MarkdownBody` hands a click on an in-app link to the router. A click asking
  for a new tab is still the browser's.
- **`target="_blank"`.** The rule that gave every rendered link `_blank` and
  `nofollow` now applies only to the links that leave. `safeReturnPath` decides
  which — the same check the sign-in flow trusts to tell a path in this app
  from a URL elsewhere wearing a leading slash.
- **A dangling reference** is not a failure (spec 02 §2.9): the target may be
  on an unfetched branch. That page says so and offers the listings.

## The one thing about the format that now ships to the browser

Recognising `#<id>` is format knowledge in a client whose whole stance is that
it holds none (spec 06 §6.3). The line I drew: finding a reference in text it
is already rendering composes nothing — what the reference *means* is still
the server's answer. `app/utils/references.ts` and the package README both say
so out loud rather than leaving it implied.

`test/node/references.test.ts` holds that reading to `@navbook/core`'s own
`extractProseRefs`, over a corpus, in Node — core is a dev dependency and
reaches no bundle. That test exists because of a real bug it caught: an id
must contain a digit (spec 02 §2.2, "the mandatory digit keeps English words
from being mistaken for IDs"), `PROSE_REF` alone only describes the shape, and
my first version linked `#deadline`, `#reverted` and `#manifest`. Removing the
digit rule fails three tests.

## What review changed

Two fixes, in a second commit:

- The rule ran after `text_join`, so `\#t4mwvm2j` and `&#35;t4mwvm2j` were
  linked like an unescaped `#`. An author had no way to opt out short of a
  code span. It now runs before `text_join`, where an escape is still a
  `text_special` token.
- `/ref/:id` navigated whenever its lookup answered. Pressing Back off the
  skeleton returned to the page the reference was on and was then yanked
  forward again — and since the route redirects, with no way back. A lookup
  now acts only while it is the current one.

A third finding is filed rather than fixed, as #x8otoby0: following a
reference in `SpecEditor`'s preview discards the draft. It is real, and it is
one way out of an editor that guards none of them — the sidebar loses the same
draft to the same click. I tried the narrow fix of opening a tab there and
backed it out: the token lives in `sessionStorage` on purpose, so a new tab
signs in again instead of landing on the reference. That guard belongs to the
page that owns the unsaved work, for every way out of it.

## Verified

- `vitest run` — 342 tests, up from 330: 12 new ones for the rendering and the
  grammar.
- `nuxi typecheck`, `tsc -p tsconfig.tools.json`, `biome check` — clean.
- `playwright test` — 139 tests against a real browser, server and repository,
  4 of them new: following a reference from a PR body to the issue it names,
  proving the navigation is the router's and not a page load, resolving an id
  that turns out to be a pull request, and the dangling case.

Each new test was checked against the bug it describes: removing the digit
rule fails three, and moving the rule back after `text_join` fails the escape
one.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
