---
title: "An inbox: what is assigned to me, what I wrote, and what I owe a review"
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-07T21:36:34Z
labels: [enhancement]
assignee: admin@brickcode.tech
feature: web
resolution: fixed
---

The listings answer "what is there"; nothing answers "what is mine". Add /inbox, one unified list of everything that concerns the signed-in person, so the next thing to work on is one page rather than three filters.

Three things put a row there, and `EntityFilter` ANDs its keys, so they are three questions merged in the client: the entity is assigned to them, they opened the pull request, or it is waiting on their review (spec 02 §2.7).

Issues somebody merely filed are not in it. Filing an issue is asking for work rather than taking it on; a pull request is the other way round, and is theirs until it lands.

Nothing is marked read. A review request leaves by being answered and an issue by being closed or reassigned, which the files already record — a read flag would be state about a person, and there is nowhere in a repository to put that which is not everybody's business (spec 06 §6.6).

Pull requests are asked for across every fetched branch without a toggle: one lives on the branch it proposes to merge, so a person's own are the ones the serving checkout is least likely to hold.

- A rail of three single-select groups — reason, kind, feature — each entry counted as what choosing it would show.
- A switch for finished work, and the listings' search box.
- Reached from the account menu, since it is one person's reading of the repository rather than another listing.
