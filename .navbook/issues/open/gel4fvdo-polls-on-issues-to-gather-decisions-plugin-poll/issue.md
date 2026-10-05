---
title: Polls on issues to gather decisions (plugin-poll)
author: Claude <noreply@anthropic.com>
created: 2026-10-05T01:28:33Z
labels: [enhancement, plugin]
assignee: noreply@anthropic.com
feature: plugins
---

A new first-party plugin, `@navbook/plugin-poll` (short `poll`), that adds polls to issues: to gather consensus on design decisions, and so agents can ask a human for decisions while planning.

A poll is an optional Markdown preamble and 1..N multiple-choice questions. Anyone, the poll's author included, may vote; only a person's latest vote counts, so a vote can be edited.

- **Questions:** single or multiple choice; each option has a label and an optional Markdown description; a question may accept a write-in ("other").
- **Ballots:** a vote is one file beside the poll, named like a comment, and is a complete ballot with an optional note. Questions may be skipped; an empty ballot withdraws.
- **Editing:** while open. Any change to the questions revokes every vote (each vote stores a fingerprint of the questions it answered); title and preamble edits keep them.
- **Lifecycle:** open until somebody closes it, recording a decision per question (the leader by default; a tied single-choice question must be decided) and an optional note. Reopening clears it. A poll on a closed issue reads as closed.
- **Results:** hidden until you vote (with a show/hide toggle) unless the poll says `results: visible`; always shown once closed. Votes are git files, so this is a presentation convention, not secrecy.
- **CLI:** `nav poll open|vote|show|list|edit|close|reopen`, `--json` throughout; `issue show` and `issue list` gain poll sections; query terms `poll:` and `poll-awaiting:`.
- **Server and web:** typed GraphQL; poll cards inline in the issue timeline, a sidebar panel, a row badge, a filter, and an inbox source "Polls awaiting your vote". Two host seams are new: `timelineItems` and `inboxSources`.

Delivered in three stacked pull requests into `dev`: spec, core and CLI; server; web seams, web layer and end-to-end tests.
