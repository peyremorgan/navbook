---
title: A people directory behind the web client's person menus
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-08T08:57:28Z
labels: [enhancement]
feature: [server, web]
resolution: fixed
parent: rmsuy3z6
---

Every person menu in the web client offers whatever the listing on screen happens to contain: the assignees on an issue, the ones on the filing form, the assignee, author and reviewer filters, and the reviewers of a pull request. That is a guess made from the answer to a different question, and it is wrong in both directions — somebody nobody has assigned yet is never offered, and the issue page fetches a whole listing only to make the guess.

The repository already knows who works on it. Add `people` to the API: everyone the repository knows of, merged from three places and stored nowhere.

- The authors of the served checkout's history, read with `%aN`/`%aE` so `.mailmap` is honoured (spec 02 §2.4). The clone's own committer is left out of this source: it commits on everybody's behalf (spec 06 §6.2), so its name on a commit says nothing about who did the work.
- Everyone the tree names — author, assignee, reviewer, merger, commenter — which is how somebody who has only ever worked through the web is known at all, since their commits are the machine account's.
- The signed-in viewer, so the first thing a new person can do is assign something to themselves.

One entry per address, compared case-insensitively (§2.4). A name comes from the first source that has one, so the most recent commit names a person before a file does, and a file names one the history left bare.

The history walk is cached in memory against the HEAD it read, so it runs once per commit rather than once per request; the tree half is the request's own read. Nothing is written down. That is the derived, disposable and uncommitted kind of index spec 06 §6.6 permits, and it is a suggestion rather than a registry: every person field still takes an address that is not in the list.

Labels and milestones keep the listing guess. There is nothing else for them to have.
