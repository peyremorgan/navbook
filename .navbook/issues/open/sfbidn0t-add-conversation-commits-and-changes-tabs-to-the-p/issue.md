---
title: Add Conversation, Commits and Changes tabs to the pull request page
author: Claude <noreply@anthropic.com>
created: 2026-09-17T22:18:59Z
labels: [enhancement]
feature: [web, pull-requests, server]
---

The pull request page of the web client shows the description and the discussion, and nothing else about what the pull request actually proposes: no list of the commits it brings, no diff of what it changes. A reviewer has to leave the tracker and open the branch in a forge or a terminal to read the change they are asked to approve.

Every other forge (GitHub, GitLab, Gitea, Forgejo) splits the PR page into three tabs, and the same shape is wanted here:

- **Conversation** — the description and the comments, i.e. what the page shows today.
- **Commits** — the commits the pull request introduces (subject, author, date, short hash), oldest first, i.e. `base..head` of the latest revision.
- **Changes** — the diff between the target branch and the source branch, file by file, with a summary line of files changed and lines added/removed.

## What is missing

Nothing in the stack can answer the two new tabs yet:

- The `Pr` GraphQL type carries `revisions { head base date }` and nothing derived from them. The only commit data the API exposes is `Feature.commits`, and there is no diff field anywhere (`packages/server/schema.graphql`).
- Core has `mergeBase`, `isAncestor`, `searchCommits` (which always walks from HEAD and takes no range) and `commitMessages(cwd, range)` (messages only, no sha/author/date). There is no helper that produces a patch, a name-status list or a diffstat (`packages/core/src/git/history.ts`).
- The web client has no tab component and no `?tab=` precedent; the nearest thing is the `?refs=all` toggle on the PR listing, kept in the query string with `router.replace` (`packages/web/app/pages/prs/index.vue`).

## Constraints

- The diff is derived from the pinned revision, not from the branch tip: `head` and `base` in the latest revision entry are the truth, `source` is intent (spec 02 §2.7). Comparing `base` with `head` is exactly the three-dot diff forges show (`git diff base...head`), and it stays correct after the target moves on.
- A pull request found by `allRefs` on a branch the server does not serve is still readable, and its commits are objects in the clone, so both tabs should work for it too (spec 06 §6.5).
- Large diffs are the hard part. GitHub renders a 75 kLoC diff in about a second; the target here is a 5 kLoC diff painted in under a second from the tab click. That means a size threshold above which the server sends a summary and the client truncates or collapses instead of rendering every line, syntax work delegated to the browser, and caching keyed on the revision pair, which never changes for a given `head`/`base` (a derived, disposable, uncommitted index — spec 06 §6.6).
