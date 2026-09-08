---
title: Inbox
---

## What exists

`/inbox`, one list of everything that concerns the signed-in person, reached from the account menu rather than from the navigation beside the listings: those are the repository, this is one person's reading of it.

- **Three reasons put a row there**: the entity is assigned to them, they opened the pull request, or they are asked to review it and have not answered the latest revision (spec 02 §2.7). Issues they merely filed are not among them — filing is asking for work rather than taking it on — and a pull request they opened is theirs until it lands.
- **One round trip**, since `EntityFilter` ANDs its keys and cannot be asked for a union: the three questions are aliased fields of one document, merged in the client. Which field an entity came back in is the whole of why a row is there; nothing in the browser compares one address with another.
- **Every fetched branch, with no toggle**. A pull request lives on the branch it proposes to merge, so a person's own are the ones the serving checkout is least likely to hold. That scan finds open pull requests only, so finished work — off by default, behind one switch — is asked of the working tree instead, and no review request is asked for there.
- **Nothing is marked read.** A request leaves by being answered and an issue by being closed or reassigned, which the files already record. A read flag would be state about a person, and the format has nowhere to put it (spec 06 §6.6).
- **Read by priority, and reordered by hand.** The inbox is the one listing that does not default to newest first: it answers "what next", which is the question a `rank` was written down to answer (spec 02 §2.5). Chips offer the other two orders. Under priority each issue row grows a grip that is both a drag source and a button, so the same move is Space, arrow keys, Space, with a live region saying what is happening; a listing only a pointer can reorder is one half the people using it cannot reorder at all. A drop writes one file — halfway between its new neighbours' ranks, or ten clear of the end of the queue — and never renumbers, which is the central index §6.6 refuses spread over every file instead of gathered into one. The unranked tail cannot be entered, since a ranked row always sorts above an unranked one, so the preview stops where a rank can actually put the row. A write that fails leaves the row where it was, which is the truth about the file.
- **A rail of three single-select groups** — reason, kind, feature — each entry counted as what choosing it would show with the other two still applied. It is the same buttons at every width, a rail beside the list or chips above it. The listings' search box is here too, and the whole view lives in the query string.

## Where it lives

- `packages/web/app/pages/inbox.vue`, `app/components/Inbox{Row,Rail}.vue`, `SortOrderChips.vue`, `DueDate.vue`
- `app/composables/{useInbox,useInboxView,useInboxReorder}.ts`, `app/utils/{inbox,inbox-params,sort,dates}.ts`
- `app/graphql/queries.ts` — `INBOX_QUERY`
- `packages/web/test/nuxt/inbox*.test.ts`, `packages/web/test-e2e/inbox.spec.ts`

## Drift from the specification

- The specification describes no per-person view. Spec 06 §6.3 defines the client as a thin UI over the listings, and this composes those listings with the address the token carries; it adds nothing to the format and asks the server nothing new.
- The order is the client's own reading, because the API has only one: it hands every listing over newest first and takes no sort argument (spec 06 §6.6). So the priority order, and the two beside it, are computed in the browser from what arrived — which also means a second front end reading the same repository has to implement §2.5's orders for itself. The CLI does, in `packages/cli/src/sort.ts`, and the specification is what the two copies are checked against.
- An inbox would still rather be sorted by what happened last, and nothing in the format records that.
