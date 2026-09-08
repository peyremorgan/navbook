---
title: Client
---

## What exists

A Nuxt single-page bundle with no server side of its own. It loads `config.json` at start, signs in with an OIDC provider by PKCE, renews tokens before they expire, and talks to `nav-server` over GraphQL through a normalised Apollo cache (spec 06 §6.3).

- **Issues**, in full: listing with a filter that lives in the URL, whose five menus share one line on a wide screen and fold behind an "Advanced search" toggle on a narrow one, detail with comments and the subtask tree, filing, editing each field in place with the smallest patch that says it, closing with a resolution, reopening, replying, linking and unlinking with the reparent question put to the person. The root and the wordmark land on the open ones, since a filter naming no status means any status; the tab beside the wordmark still means the whole listing.
- **Pull requests**, read and reviewed: listing with that same filter, the all-branches toggle and an "awaiting me" one, revisions, comments and reviews bound to a revision, the people asked to review with what each has said about the latest revision and the decision that adds up to, editable in place, and the refusal to write on a branch the server does not hold, shown with the branch it names.
- **The review policy** (spec 02 §2.10) beneath the reviewers, where the repository declared one, with the approvals counted on the badge where more than one is wanted — so a pull request reading `pending` with an approval on it is accounted for rather than looking like a bug in the page. A marker nobody can read is drawn as a warning, since the numbers are then the defaults. Nothing is disabled by any of it: merging is not exposed, and a policy gates nothing anywhere.
- **An inbox** of what concerns the signed-in person, reached from the account menu: what is assigned to them, the pull requests they opened, and the reviews they still owe, merged from three questions into one list that says why each row is in it. See [Inbox](inbox.md).
- **Priority and deadlines** on issues (spec 02 §2.5): a rank chip and a due badge on a row, a number field and a date field on the page and on the filing form, chips that narrow to what is overdue or undated, and chips that read the listing by priority, by deadline or newest — the last being the default, and the order living in the query string beside the filter rather than being cleared with it. The badge counts days against the *reader's* calendar while the filter is judged against the server's, so for the few hours those disagree each is right about its own day.
- **Features**: the listing, a page per feature with its documents and a timeline of issues, pull requests and commits, and a document editor with a preview. A stale save keeps the draft and shows the other version.
- **People** in every menu that names one — the assignees on an issue and on the filing form, the assignee, author and reviewer filters on both listings, and the reviewers of a pull request — come from the server's `people` rather than from whatever the listing on screen happened to hold. A listing can only name somebody already written down, so the person nobody has assigned anything to yet was exactly the one it could never offer. The menus stay creatable: the list is derived rather than authoritative, and an address it has never seen is still a valid one. Labels and milestones are still read off the listing, because for those there is nothing else to read.
- **Commits** are reported after every write, including the case where nothing was pushed.
- **Theme** follows the browser, with a switch that is remembered in that browser and nowhere else.
- **Markdown** is rendered by `markdown-it` with raw HTML off and passed through DOMPurify; that is the one path from text to HTML.

Nothing about the format ships to the browser: the client sends fields, and every write goes through the server.

## Where it lives

- `packages/web/app/` — pages, components, composables, `graphql/` operations, `utils/`
- Development stack and fixture repository: `packages/web/script/`
- End-to-end suite against a built bundle, a real server and a real repository: `packages/web/test-e2e/`

## Drift from the specification

None found. Spec 06 §6.3 and §1.7 describe the client as built; the scope stated there and in `packages/web/README.md` matches what exists.
