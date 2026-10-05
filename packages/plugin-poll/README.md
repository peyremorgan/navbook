# @navbook/plugin-poll

**Polls** on issues: a question, or several, put to the people working on an
issue, so a design decision is made by asking rather than by reading a thread.
An agent planning a change uses the same thing to ask a person to decide.

A poll is an optional preamble in Markdown and one or more questions. A question
is single- or multiple-choice, each option a label with an optional description,
and may accept an answer in the voter's own words. Anyone may vote, the poll's
author included; voting again replaces your last ballot. Somebody closes the
poll when it has served, recording what each question came to.

```
.navbook/issues/open/k3m9x2q1-attachments/
├── issue.md
└── poll/
    └── p4w8n2x6-attachment-storage/
        ├── poll.md
        ├── 2026-10-04T101500Z-v7q2w8e4.md
        └── 2026-10-04T113000Z-b2m6k9p3.md
```

Each vote is a file of its own, named like a comment, so two people voting at
once never conflict. What the votes add up to is never stored: it is read off
the files. Changing a poll's questions revokes every ballot cast before the
change, since a ballot answers the questions as they were; the voters are asked
again, starting from what they said.

```console
$ nav poll open k3m9 --from poll.md --commit       # or $EDITOR on a template
Opened poll p4w8n2x6 on #k3m9x2q1  .navbook/issues/open/k3m9x2q1-attachments/poll/p4w8n2x6-attachment-storage

$ nav poll vote p4w8                                # one question at a time, then one "yes"
$ nav poll vote p4w8 --pick backend=s3 --pick limits=size,count -m "We run S3 already." --commit
$ nav poll vote p4w8 --other backend="MinIO on our own box" --commit
$ nav poll list                                     # the open polls waiting on you
$ nav poll show p4w8                                # results hidden until you vote, or --results
$ nav poll close p4w8 --decide backend=s3 -m "S3, both limits." --commit
$ nav issue list poll:open
$ nav issue show k3m9                               # a "polls" section
```

| Command | What it does |
|---|---|
| `nav poll open <issue> [--from FILE\|-] [--title T]` | Open a poll; `--from` takes a file shaped like `poll.md`, IDs optional |
| `nav poll vote <poll> [--pick Q=A,…] [--other Q=TEXT] [--clear Q] [-m NOTE]` | Vote, starting from your last ballot (`--fresh` from nothing); with no flags at a terminal, ask about each question |
| `nav poll vote <poll> --withdraw` | Take your vote back |
| `nav poll show <poll> [--results] [--json]` | The questions, where you stand, and the results when they are shown |
| `nav poll list [--all] [--state open\|closed] [--issue ID] [--json]` | By default, the open polls waiting on you |
| `nav poll edit <poll> [--from FILE\|-]` | Change an open poll; changing its questions revokes every vote |
| `nav poll close <poll> [--decide Q=A,…] [--decide-other Q=TEXT] [-m NOTE]` | Record what each question came to: the leader unless you decide otherwise, and a tie only you can break |
| `nav poll reopen <poll>` | Clear the decision and resume voting |

Questions and options are named by ID or by number from 1 wherever a command
takes one. A poll is *waiting on* you when it is open and you filed the issue,
hold it or commented on it, and have no ballot that counts — or when the
questions changed under the one you cast. `poll-awaiting:EMAIL` finds those
issues in `nav issue list`.

A poll file, as `--from` takes it:

```markdown
---
title: Attachment storage
results: hidden          # or visible: show the tallies before people vote
deadline: 2026-10-15     # advisory
questions:
  - id: backend          # IDs are optional here: q1, q2… and the labels as slugs
    text: Which storage backend?
    other: true          # also accept an answer in the voter's own words
    options:
      - id: s3
        label: S3-compatible
        description: Cheap and durable; the server needs credentials.
      - label: Local disk  # its ID: local-disk
  - id: limits
    text: Which limits do we enforce?
    multi: true          # any number of answers, rather than exactly one
    options:
      - { id: size, label: Max file size }
      - { id: count, label: Max files per issue }
---

Issues need attachments. Before anything is built we need to agree on where
they are kept and what we refuse.
```

Votes are files in the repository: whoever can read the tree can read who voted
for what. `results: hidden` keeps a front end from showing the tallies to
somebody who has not voted yet, so the leader does not decide their vote for
them; it hides nothing from anybody who looks.

[`doc/spec.md`](doc/spec.md) is this plugin's specification: the files, the
fingerprint that revokes a ballot, how tallies and decisions are derived, and
what a tool without the plugin does with them — which is to preserve them
untouched.

## Asking from an agent

An agent working on an issue asks by opening a poll and stopping:

```sh
nav poll open "$ISSUE" --from - --commit <<'EOF'
---
title: Pagination for the issue list
questions:
  - text: Which pagination?
    options:
      - { label: Cursor-based, description: Stable under inserts; no page numbers. }
      - { label: Offset-based, description: Page numbers; rows shift as issues are filed. }
---

The list endpoint returns everything today; at 10 000 issues it takes 4 s.
EOF
git push
```

People vote and somebody closes the poll. Told it is decided, the agent pulls
and reads the outcome:

```sh
git pull --ff-only
nav poll show "$POLL" --json | jq '{status, outcome, "decision-note"}'
```

`--json` always carries the tallies and `outcome`: what the poll was closed
with, what a poll its issue closed came to, and `null` while it is open.

## Installing it

```sh
nav plugin install @navbook/plugin-poll
```

And in the repository's `.navbook/navbook.json`, so every clone knows the tree
has polls in it:

```json
{
  "version": 1,
  "plugins": {
    "@navbook/plugin-poll": {}
  }
}
```

## What it adds

| Where | What |
|---|---|
| Format | `poll/<id>-<slug>/poll.md` and its votes inside issue directories; checks X-poll-1 to X-poll-3 |
| CLI | `nav poll {open,vote,show,list,edit,close,reopen}`, a "polls" section and `polls` JSON on `nav issue show`, the `poll:` and `poll-awaiting:` terms on `nav issue list` |
| API | `Poll` and `Query.poll`, `polls` on `Issue`, five mutations (a ballot is the signed-in person's), `myState` and `myDraft` for the viewer, `polls` and `pollAwaiting` issue filters, and `ext.poll` on issue rows |
| Web | a Nuxt layer: each poll as a card in its issue's discussion, where it was asked — the ballot, the results behind a toggle until you vote, the decision — a polls panel with **New poll** in the issue's sidebar, a badge on its rows, a `poll` chip in the issue filter bar, and **Polls awaiting me** in the inbox |
| Commits | the `docs(poll): …` scope, with a `Refs:` trailer naming the issue |

The web half is compiled into the client rather than loaded by it, so a
deployment that wants polls in the browser builds with this package named:

```sh
NAVBOOK_PLUGINS="@navbook/plugin-poll" docker compose build
```

That one value sets both images: the API installs the plugin, and the client
merges the layer.

## Without it installed

A `nav` without this plugin preserves `poll/` inside issue directories and
interprets nothing in it. Closing, reopening and archiving an issue carry its
polls with it, and `doctor` says nothing about them.
