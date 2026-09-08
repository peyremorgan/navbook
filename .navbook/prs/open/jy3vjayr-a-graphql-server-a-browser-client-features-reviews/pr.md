---
title: A GraphQL server, a browser client, features, reviews that count, and a container deployment
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-08T10:41:46Z
target: main
source: dev
labels: [enhancement]
feature: [server, web, features, issues, pull-requests, packaging, cli, doctor]
revisions:
  - head: dccfb5095151872ba84fc4dd301152cf40d20f65
    base: 77041378c9307c8b4d9635a8709ada48910df5de
    date: 2026-09-08T10:41:46Z
---

Everything on `dev` since `main` last moved: 169 commits, 742 files. Two new packages — a GraphQL server and a browser client — and the format grew four keys, a directory and a marker section to feed them.

The through-line is that the tracker stopped being one front end. Where behaviour is derived rather than stored, it now lives in `@navbook/core` and both front ends read it from there; where a front end has to compute for itself, the specification is what the two copies are checked against.

## Features

### A GraphQL API — `@navbook/server`

`nav-server` serves one clone. Before a read it pulls if it has not within the interval; around a write it pulls, runs the operation, commits and pushes, under one lock. A push it cannot fast-forward is retried once after a pull and then reported; a merge it cannot complete is aborted and reported. Conflicts surface — nothing is resolved on anybody's behalf.

- Identity comes from an OIDC bearer token whose `email` claim becomes `author:`; the machine account is the committer. There is no authorization: any token the issuer signs for the audience may write.
- Reads: `issues`, `issue`, `prs` (with `allRefs` for the cross-branch scan), `pr`, `features`, `feature`, `doctor`, `viewer`, `reviewPolicy`, `people`. A listing is the whole matching set; there is no pagination, and no sort argument — an order the server owned would be the index §6.6 refuses.
- Writes: `openIssue`, `updateIssue`, `closeIssue`, `reopenIssue`, `updatePr`, `addComment`, `linkIssue`, `unlinkIssue`, `createFeature`, `updateFeature`, `addSpec`, `updateSpec`. Every payload returns `commit { committed subject pushed }`, and a client is expected to say so when `pushed` is false.
- Composing stays on the server: a client sends fields, the server builds the file with core's constructors and validates before anything is written. Patches distinguish absent from `null`, and unknown frontmatter keys always survive.
- Refusals are named: `REPARENT_REQUIRED`, `PRECONDITION`, `STALE_CONTENT`.
- Not exposed: opening a pull request, appending a revision, merging, deleting anything, `init`, `doctor --fix`.

### A browser client — `@navbook/web`

A Nuxt single-page bundle with no server side of its own. It loads `config.json` at start, signs in by OIDC PKCE, renews tokens before they expire, and talks to `nav-server` through a normalised Apollo cache. Nothing about the format ships to the browser.

- **Issues, in full** — listing with a filter that lives in the URL, detail with comments and the subtask tree, filing, editing each field in place with the smallest patch that says it, closing with a resolution, reopening, replying, linking and unlinking with the reparent question put to the person.
- **Pull requests, read and reviewed** — the same filter plus an all-branches toggle and "awaiting me", revisions, comments and reviews bound to a revision, the people asked to review with what each said about the latest revision, and the refusal to write on a branch the server does not hold, shown with the branch it names.
- **Features** — the listing, a page per feature with its documents and a timeline of issues, pull requests and commits, and a document editor with preview.
- **Theme** follows the browser, with a switch remembered in that browser and nowhere else.
- **Markdown** goes through `markdown-it` with raw HTML off and DOMPurify after it; that is the one path from text to HTML.
- Commits are reported after every write, including the case where nothing was pushed.

### An inbox (#j2w7kse7)

`/inbox` — one list of what concerns the signed-in person, reached from the account menu rather than the navigation beside the listings: those are the repository, this is one person's reading of it.

Three reasons put a row there: the entity is assigned to them, they opened the pull request, or they are asked to review it and have not answered the latest revision. It is one round trip — `EntityFilter` ANDs its keys and cannot be asked for a union, so the three questions are aliased fields of one document, merged in the client. Which field a row came back in is the whole of why it is there.

It scans every fetched branch with no toggle, since a pull request lives on the branch it proposes to merge. Nothing is marked read: a request leaves by being answered and an issue by being closed or reassigned, which the files already record. A read flag would be state about a person, and the format has nowhere to put it.

It is the one listing that does not default to newest first — it answers "what next" — and under priority each row grows a grip that is both a drag source and a button, so the same move is Space, arrows, Space, with a live region narrating it.

### Review requests, a third verdict, and a derived state (#b26np83t)

`reviewer:` on `pr.md` names the people asked, in the shape `assignee` takes. Being listed is being asked, and that is the entire record of the request. Nothing marks a request answered — a key the reviewer's commit clears would put every review into the one file the author is also editing, and manufacture a conflict out of two actions that do not contradict each other.

Everything about "who still owes a look" is computed from the comments against the latest revision: a person's state is their latest opinionated verdict, else `commented`, else `pending`; the people counted are those `reviewer:` names plus anyone who volunteered a verdict on that revision; the decision is `changes-requested` if anyone blocks, `approved` at `minApprovals` with nobody blocking, `pending` otherwise. Appending a revision returns everybody to `pending`.

`verdict: comment` is a review that judges nothing. It binds to a revision, satisfies a request, and never counts toward the decision — and it is what `nav pr review` writes when no verdict flag is given.

Surfaces: `nav pr request <id> <email>... [--remove]`, `nav pr open --reviewer`, `nav pr review --comment`, the query terms `reviewer:`, `review:` and `awaiting:`, a `reviewer` and `review` column on `nav pr list`, `reviewers`/`reviews`/`reviewDecision` on the API, and the review panel in the client.

### A configurable review policy (#etl34tu3)

`navbook.json` may carry a `review` object: `selfReview`, whether the author is among the people counted, and `minApprovals`, how many approvals `approved` takes. Both default to what the spec describes without them — no self-review, one approval — so a repository that declares nothing, and every repository written before the key existed, reads exactly as it did.

It is advisory, and that is not a hedge about enforcement arriving later. What a policy changes is what the reading counts, and therefore what every surface reporting that reading says. It never changes what anything does:

- `nav pr merge` prints what is missing and asks `Merge anyway? [y/N]`. `--yes` answers in advance; a run with no terminal warns and merges, because a pipeline that stopped for a question nobody can answer would be a gate arrived at by accident. Answering no exits 1 — the operator's decision, not the tool's.
- `nav pr review --approve` on your own pull request writes the file and warns that it will not count. The review is a record of what somebody said and is never refused.
- The API serves a policy nobody can read rather than raising: `problems` says what was wrong while every field beside it holds the default.

This repository now declares its own policy in `.navbook/navbook.json`.

### Features and a `specs/` directory (#wi17ddic)

A feature is `specs/<slug>/`, holding a `feature.md` identity card and any number of Markdown documents. It has no ID, because its name is what an entity's `feature:` key names, and no status, because a standing concept does not open and close. Nothing lists its members: an issue or pull request names the features it belongs to, so two people attaching two issues never touch one file.

- Attach with `feature: auth` or `feature: [auth, mobile]`, `--feature` on `nav issue open` and `nav pr open`, or `feature:` in a listing query.
- `nav feature open|list|show|edit` and `nav feature spec add|edit|list`. `show` renders the card, the documents, the attached work and the commits that touched any of it.
- History: a commit counts when it changed the feature's documents, a member's directory, or names a member by ID in prose or a `Refs:`/`Closes:` trailer. Derived from `git log` on demand, never stored.
- Editing carries the hash the editor started from; a save whose file has moved on is refused with `STALE_CONTENT` rather than landed on top of somebody else's paragraph.
- Reading is more generous than writing: a hand-written `Session Policy.md` is a document; a tool only mints slug-shaped names and never `feature.md`.

`specs/` is not part of the `nav init` skeleton — the first feature brings it with it. This repository's own fourteen features are filed under `.navbook/specs/`, and every issue is attached to one.

### Rank and deadline (#rhr7h3k8)

`rank:` is a decimal, lower first; `deadline:` is a bare calendar date. Both are issue-only and a schema fault on `pr.md`. Placing an issue rewrites only the issue that moved — a value halfway between its new neighbours', or ten clear of the end of the queue. Nothing renumbers, which is what keeps two people reordering different work out of each other's files.

`nav issue list --sort priority|deadline|newest`, and `deadline:overdue|none` judged against the day the command runs. Columns appear when any issue listed carries one. In the client, a rank chip and a due badge on a row, a number field and a date field on the page and the filing form, and drag-to-place. The badge counts days against the reader's calendar while the filter is judged against the server's, so for the few hours those disagree each is right about its own day.

### A people directory (#o4kt93fo)

`people` answers who the repository knows of, for the fields that name one. Three sources merged into one entry per address: the authors of the served branch's history read through `%aN`/`%aE` so `.mailmap` stays git's business; everyone the tree names as author, assignee, reviewer, merger or commenter; and the signed-in viewer. The clone's own committer is left out of the history alone — it commits on everybody's behalf, so its name on a commit says who runs the server.

Every person menu in the client now reads from it rather than from whatever listing happened to be on screen — which was a guess made from the answer to a different question, and wrong in both directions: somebody nobody had assigned yet was never offered, and the issue page fetched a whole listing to make the guess. Only the history walk is cached, keyed on the HEAD it read; the tree half is the request's own read. Nothing is written down, and the menus stay creatable — it is a suggestion rather than a registry.

### A configurable Navbook root

The directory's name is no longer fixed. `navbook.json` is the marker, discovery finds the root by it, and `NAV_ROOT` names one directly. Paths in the specification are no longer defined as relative to `.navbook/`, and the server resolves the directory once at startup rather than per request.

### Smaller front-end work

- The root and the wordmark land on the open issues (#nmnq562b), since a filter naming no status means any status.
- Each listing reopens with the filter it was left on, per tab; a bare URL does not. The tab beside the wordmark is what remembers; the wordmark goes home every time, because two adjacent links both returning to the remembered filter would be one link drawn twice.
- The filter bar's five menus share one line on a wide screen and fold behind an "Advanced search" toggle below `md` (#qrudyd2x).
- A filter naming no status now lists every status, rather than defaulting to open — the `status:open` default belongs to the CLI's `list` verbs at the terminal alone.

## Fixes

**Core**
- `markersInIndex` read `git ls-files -z` through a helper that trims. The output is NUL-delimited, so a leading space genuinely belonging to the first path's name was eaten and discovery reported a directory that does not exist.
- `hasNavbook` was `existsSync`, so a `NAV_ROOT` naming a plain file counted as a tracker: `nav issue list` answered "No issues match this query" for a path that could never hold an issue, and the first write failed with a raw ENOTDIR. A plain file named `.navbook` also shadowed the marker search and hid a good directory elsewhere. Both now test for a directory.
- A feature's timeline sorted by author date and broke ties on the sha, so three commits a script made inside one second came out in sha order — indistinguishable from a bug. Position within the walk is the tie-break now; the sha only settles a tie between two walks.

**Server**
- A mutation's payload was read back after the write transaction had released the lock, so the next mutation was free to move the files being reported on. It now happens inside the transaction, from a single load of the tree.
- The memo behind `baseSha` was keyed by slug and lived for the request, so a document holding two writes to one feature reported the first write's hashes for the second. A client saving with one would have been refused as out of date — the exact failure the mechanism exists to prevent. Keyed by record now.
- Five faults found reviewing the new package, each reachable from a request and each with a test that fails without the fix. Among them: an edit that could not be committed left its patched file behind, to become the base of the next edit and be committed under somebody else's request; and a `GIT_ERROR` repeated git's stderr to the client, which can carry the remote's URL with its credentials, server-side paths and hook output. That goes to the log now.

**CLI**
- `nav pr request` wrote whatever it was handed, so asking a team by name left behind a file the next `nav doctor` called broken — a tool creating a fault it then reports. It refuses now and says what a reviewer looks like. Removing still accepts any name, because that is how a hand-written mistake is undone.
- `nav pr show` hid the decision whenever nobody had been asked, which is right for a repository counting one approval and wrong for one counting two: under a policy wanting more than one, the policy is the ask.
- `readReviewPolicy` opened the marker directly, so a path that is not a readable file threw where a listing should have carried on. It now reads as no marker at all.
- `show` hid `rank` on a pull request while `deadline` beside it was rendered. Both keys on a `pr.md` are a D2 fault, and somebody reading one is reading it to find out what the file says.

**Web**
- Four faults in how the client handles a write that does not land: the comment box emptied itself on submit, so a refused comment took the words with it; the review box never emptied, so the obvious next click posted twice; an edit that emptied a title closed the editor and then said so in a toast.
- The stale-save alert offered "Load what it says now" and then kept the draft, so the button did nothing visible while the reload behind it quietly moved the base. Both versions are shown now — the draft in the editor, the file rendered above it — so saving again is an overwrite made with the other version in front of you.
- The reviewers panel kept its pencil on a pull request the server had already refused to write to, so a second attempt could be typed and lost the same way.
- The detail page read the derived states and the listing row read the request, so a pull request nobody asked but somebody reviewed anyway got a pending badge on one screen and none on the other.
- An inbox row's status was the colour of its icon and nothing else, so it reached nobody using a screen reader; and "Try again" did nothing when the failure was the one that happens first, because the address the inbox is about comes from its own query.
- An empty inbox and a search that found nothing now read differently.
- The dev issuer's host-name option did nothing.

## Documentation and specification

`doc/spec/` gains rank and deadline, the review fields and the third verdict, the review policy, the marker and a root name that is not fixed, and features and specifications. Fourteen features are filed under `.navbook/specs/`, each with a "What exists / Where it lives / Drift from the specification" card, and every issue is attached to one. The drift sections are honest: the `--edit` flag the spec lists on the composing verbs does not exist, and the Rust rewrite of §5.3 has not begun.

The README gains sections on naming the directory something else, deploying, running the web client, and building and testing it.

## Packaging and CI

Two container images and a compose file, for deploying behind a Traefik that is already running (#rop9bg3d):

- `packages/server/Dockerfile` packs the tarballs `pnpm publish` would upload and installs them onto `node:24-alpine` plus git, so what runs is the `dist/` the registry serves rather than an arrangement that only holds inside the workspace.
- `packages/server/docker/entrypoint.sh` is the deployment's only stateful logic: it fetches into the volume on first start, finishes one a previous start left half-made, and passes credentials through `GIT_CONFIG_COUNT` rather than writing them into the clone, so a rotated token is a restart. It does not repair a clone — a dirty tree is how a `SYNC_CONFLICT` is left for a person to reconcile.
- `packages/web/Dockerfile` puts the generated bundle in nginx, with `config.json` written from the environment at every start. One image serves every deployment.
- `compose.yaml` and `.env.example` map one `NAVBOOK_` namespace onto the variables the images read. Keys with no sensible default are refused at `up` rather than at somebody's first mutation.

The clone is the only volume, because it is the only durable state. Neither container is on a network with the other, because the browser talks to both.

CI gains a `docker` job that builds both images and proves they come up, and `test/deploy/` covers the images, the entrypoint and web config drift. Generated types — the server's resolver types and the client's documents — are committed, and CI checks they match the schema.

## Worth knowing before merging

- **Two new error-level doctor checks.** D13 (the layout and schema of `specs/`) and D15 (the marker's review policy) exit 2. D14 (a `feature:` naming a directory this tree lacks) is a warning. A tree with a malformed `specs/` or `review` object that passed `nav doctor` before will now fail it — including through the pre-commit hook.
- **`nav issue list` with a filter naming no status now lists every status.** Previously such a filter fell back to open. The `status:open` default is still applied for a bare `list` at the terminal.
- **No version bump.** All four packages remain at 0.2.0; `@navbook/web` is built but not published.
- **The API is unauthenticated beyond the token.** Any token the issuer signs for the audience may write, and there is no authorization layer. That is deliberate for now, and it is the thing to look at before this is exposed to anyone you would not give commit access.
- **Nothing gates a merge.** `nav pr merge` merges a pull request nobody approved, and merges one short of the declared policy — it only says so first.
