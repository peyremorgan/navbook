---
title: Inbox
---

## What exists

`/inbox`, one list of everything that concerns the signed-in person, reached from the account menu rather than from the navigation beside the listings: those are the repository, this is one person's reading of it.

- **Three reasons put a row there**: the entity is assigned to them, they opened the pull request, or they are asked to review it and have not answered the latest revision (spec 02 §2.7). Issues they merely filed are not among them — filing is asking for work rather than taking it on — and a pull request they opened is theirs until it lands.
- **One round trip**, since `EntityFilter` ANDs its keys and cannot be asked for a union: the three questions are aliased fields of one document, merged in the client. Which field an entity came back in is the whole of why a row is there; nothing in the browser compares one address with another.
- **Every fetched branch, with no toggle**. A pull request lives on the branch it proposes to merge, so a person's own are the ones the serving checkout is least likely to hold. That scan finds open pull requests only, so finished work — off by default, behind one switch — is asked of the working tree instead, and no review request is asked for there.
- **Nothing is marked read.** A request leaves by being answered and an issue by being closed or reassigned, which the files already record. A read flag would be state about a person, and the format has nowhere to put it (spec 06 §6.6).
- **A rail of three single-select groups** — reason, kind, feature — each entry counted as what choosing it would show with the other two still applied. It is the same buttons at every width, a rail beside the list or chips above it. The listings' search box is here too, and the whole view lives in the query string.

## Where it lives

- `packages/web/app/pages/inbox.vue`, `app/components/Inbox{Row,Rail}.vue`
- `app/composables/{useInbox,useInboxView}.ts`, `app/utils/inbox{,-params}.ts`
- `app/graphql/queries.ts` — `INBOX_QUERY`
- `packages/web/test/nuxt/inbox*.test.ts`, `packages/web/test-e2e/inbox.spec.ts`

## Drift from the specification

- The specification describes no per-person view. Spec 06 §6.3 defines the client as a thin UI over the listings, and this composes those listings with the address the token carries; it adds nothing to the format and asks the server nothing new.
- The order is `created` descending, because that is the only order the API has. An inbox would rather be sorted by what happened last, and nothing records that.
