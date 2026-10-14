# Polls

**Normative.** This document defines the data `@navbook/plugin-poll` keeps in
a Navbook tree, in the sense the [Navbook specification](../../../doc/spec/README.md)
defines the rest of it. A plugin that owns data must publish one
([02 §2.12](../../../doc/spec/02-data-model.md)), because a tree is meant to
outlive the tool that wrote it, and data nobody can look up is data nobody can
keep.

The key words MUST, SHOULD and MAY are used as the Navbook specification uses
them.

## 1. What this is

A **poll** asks the people working on an issue to choose: a design among three,
the limits worth enforcing, whether a plan is ready. It is an optional preamble
in Markdown — the context a voter needs — and one or more **questions**, each
offering a list of **options**. A question is either single-choice (exactly one
answer) or multiple-choice (one or more), and MAY accept a **write-in**: an
answer in the voter's own words, for when none of the options says it.

A **vote** is one file, named like a comment
([02 §2.6](../../../doc/spec/02-data-model.md)), so two people voting at once
can never conflict. Each vote is a complete **ballot**: the answers to every
question its author chose to answer, and an optional note saying why. A person
changes their mind by voting again; only their latest ballot counts.

A poll is open until somebody **closes** it, recording the **decision** each
question came to. Until then the poll may be edited — but a change to its
questions changes what every earlier ballot answered, so it **revokes** them all
(§5), and voters are asked again.

What the votes add up to — the tallies, who is leading, the decision a poll
would come to now — is never stored. It is derived from the files (§6), so it
cannot disagree with them.

Votes are files in a git repository: everybody who can read the tree can read
who voted for what. Nothing in this format is secret, and a tool MUST NOT
suggest otherwise.

## 2. Where the data lives

This plugin's short name is `poll`. It occupies one of the namespaces
[02 §2.12](../../../doc/spec/02-data-model.md) reserves — `poll/` inside an
issue's directory — and no frontmatter key and no top-level directory.

| What | Where |
|---|---|
| A poll | `<issue directory>/poll/<id>-<slug>/poll.md` |
| A vote | `<issue directory>/poll/<id>-<slug>/<YYYY-MM-DDTHHMMSSZ>-<id>.md` |

```
.navbook/issues/open/k3m9x2q1-attachments/
├── issue.md
├── comments/
│   └── 2026-10-04T093000Z-a8c4d2e7.md
└── poll/
    └── p4w8n2x6-attachment-storage/
        ├── poll.md
        ├── 2026-10-04T101500Z-v7q2w8e4.md
        └── 2026-10-04T113000Z-b2m6k9p3.md
```

- `poll/` MUST contain only poll directories. A poll directory's name follows
  the entity directory grammar of 02 §2.3: an ID of 02 §2.2, a hyphen, and a
  slug. The ID is the poll's; the slug is display only, taken from the title
  when the poll is created and never changed after.
- The poll's ID MUST be unique among every entity, comment, poll and vote ID in
  the repository, as an entity's is.
- A poll directory MUST contain `poll.md`. Every other `.md` file directly in
  it MUST be a vote (§4). Anything else in it — a subdirectory, a file of
  another type — MUST be preserved and MUST NOT be interpreted.
- Votes live beside `poll.md`, not in a directory of their own: the poll's
  directory exists from the moment the poll does, so a vote never creates a
  directory, and a vote racing the issue's close on another branch is carried
  by git's rename detection like any file in a directory both sides have
  ([03](../../../doc/spec/03-merge-and-branches.md)).
- `poll/` belongs to issues. `poll/` inside a pull request's directory has no
  meaning here; like any extension namespace nobody claims, it is preserved.
- Polls travel with their issue: closing, reopening and archiving move the
  issue's directory, and its polls with it. An archived issue's polls are read
  like any other.

A poll created on one branch while the issue is closed on another can be left
behind by the merge, at the old path: the poll's directory was new on one side
and git has nothing to carry it by. `doctor` reports the directory left
without an `issue.md` (D1). Move the stranded `poll/<id>-<slug>/` into the
issue's new directory, beside its other files, and commit the move.

## 3. `poll.md`

```markdown
---
title: Attachment storage
author: Claude <noreply@anthropic.com>
created: 2026-10-04T10:00:00Z
results: hidden
questions:
  - id: backend
    text: Which storage backend?
    other: true
    options:
      - id: s3
        label: S3-compatible
        description: |
          Cheap and durable; the server needs credentials in its environment.
      - id: disk
        label: Local disk
  - id: limits
    text: Which limits do we enforce?
    multi: true
    options:
      - { id: size, label: Max file size }
      - { id: count, label: Max files per issue }
---

Issues need attachments: screenshots, logs, the odd PDF. Before anything is
built we need to agree on where they are kept and what we refuse.
```

| Key | Req. | Type | Meaning |
|-----|------|------|---------|
| `title` | MUST | string | The poll's name, for display; one line |
| `author` | MUST | person | Who opened it |
| `created` | MUST | timestamp | When it was opened |
| `questions` | MUST | list | What it asks (§3.1); at least one |
| `results` | MAY | `hidden` or `visible` | When a front end shows the tallies (§6.4); `hidden` when absent |
| `deadline` | MAY | date | `YYYY-MM-DD`: when an answer is wanted. Advisory: nothing closes a poll by itself |
| `closed` | MAY | timestamp | When it was closed (§3.2); absent while open |
| `closed-by` | with `closed` | person | Who closed it |
| `decision` | MAY, with `closed` | map | What each question came to (§3.2) |
| `decision-note` | MAY, with `closed` | string | Why, in Markdown |

The body is the **preamble**: Markdown, and MAY be empty. A poll MUST NOT carry
`status`. Unknown top-level keys are preserved (02 §2.4). How much a poll may
hold — how many questions, how long a title — is §4.2.

### 3.1 Questions

Each entry of `questions` is a map:

| Key | Req. | Type | Meaning |
|-----|------|------|---------|
| `id` | MUST | slug | Names the question in votes and decisions; unique within the poll |
| `text` | MUST | string | The question; one line |
| `multi` | MAY | boolean | True for a multiple-choice question; false when absent |
| `other` | MAY | boolean | True when a write-in is accepted; false when absent |
| `options` | MUST | list | What may be chosen; at least one |

Each entry of `options` is a map:

| Key | Req. | Type | Meaning |
|-----|------|------|---------|
| `id` | MUST | slug | Names the option in votes and decisions; unique within its question |
| `label` | MUST | string | The option, briefly; one line |
| `description` | MAY | string | More about it, in Markdown |

- A slug follows the grammar of 02 §2.3: `^[a-z0-9]+(-[a-z0-9]+)*$`.
- A question MUST offer at least two choices, counting a write-in as one: two
  options, or one option and `other: true`.
- `text` and `label` MUST NOT be empty or only whitespace, and MUST NOT contain
  a line break.
- A `description` is read without its trailing whitespace — the line break a
  YAML block scalar ends with is formatting, not text — and one left empty by
  that is no description.
- **Whitespace**, in this document, is exactly what ECMAScript's
  `String.prototype.trim` removes, listed so that every reader removes the
  same: U+0009 to U+000D, U+0020, U+00A0, U+1680, U+2000 to U+200A, U+2028,
  U+2029, U+202F, U+205F, U+3000 and U+FEFF. A **line break** is U+000A,
  U+000D, U+0085, U+2028 or U+2029. A description that ends in a no-break
  space is read without it, and its fingerprint (§5) is taken without it.
- A key not defined here, in a question or an option, is a fault. Unlike a
  top-level key it cannot be preserved harmlessly: a reader that ignored a
  future `max-picks` would count ballots the poll says are invalid.
- A scalar YAML would read as something other than a string — a label `1.10`,
  an ID `42`, a text `yes` — is read as the text written, exactly as a built-in
  string key is (02 §2.4). A tool writing one quotes it.
- A null — `~`, `null`, or nothing after the colon — is not text: the key reads
  as left out, as a built-in key's does. `label: null` is a fault, `id: ~` is a
  missing ID, `description: ~` is no description and `multi: ~` is false. A
  label that says null is written `label: "null"`.

### 3.2 Closing

A poll is **open** until `closed` is set. Closing records, in one change to
`poll.md`: `closed`, `closed-by`, and optionally `decision` and
`decision-note`.

`decision` maps a question's `id` to what it came to, in the shape of an answer
(§4.1):

```yaml
decision:
  backend: { picks: [s3] }
  limits: { picks: [size, count] }
decision-note: |
  S3, with both limits; MinIO stays an option for self-hosters.
```

- Every key MUST be a question of the poll, and every answer MUST be valid for
  its question by the rules of §4.1.
- A question without an entry has no decision: nobody voted on it, or the
  closer left a tie undecided.
- `closed-by` MUST be present exactly when `closed` is. `decision` and
  `decision-note` MUST NOT be present without `closed`.
- A tool closing a poll writes `closed` no earlier than the latest valid vote
  in the poll's directory (§4 can stamp one ahead of the clock), so that no
  ballot it read reads as late — a withdrawal made late would bring back the
  ballot it withdrew. It does not wait for a vote stamped more than five
  minutes ahead of its own clock: only a wrong clock or a hand edit writes one
  (X-poll-2, §8), and waiting for it would close the poll in 2099 because one
  file says so. That vote is then late, like any vote cast after the close.

**Reopening** removes all four keys. The poll is open again; the decision it
had is in the history. A vote cast while it was closed — which no tool writes,
so a race or a hand edit — is no longer late (§6.1), and counts like any other;
a tool reopening a poll SHOULD say how many there are.

A poll whose issue is closed reads as closed (§6.2) without `closed` being set:
closing an issue is a statement that the work is over, and a poll still asking
about it would be asking nobody.

## 4. Vote files

A vote file's name is `<YYYY-MM-DDTHHMMSSZ>-<id>.md`, the grammar of a
comment's file name (02 §2.6). The timestamp is when the vote was cast, in UTC;
the ID is a fresh ID of 02 §2.2, and MUST be unique among every entity,
comment, poll and vote ID in the repository.

```markdown
---
author: Morgan Peyre <morgan@example.com>
fingerprint: 3f9c2a7b1e0d4c88
answers:
  backend: { picks: [], other: MinIO on our own box }
  limits: { picks: [size] }
---

We already run MinIO for the CI cache.
```

| Key | Req. | Type | Meaning |
|-----|------|------|---------|
| `author` | MUST | person | The voter |
| `fingerprint` | MUST | 16 hex | The fingerprint (§5) of the questions this ballot answered |
| `answers` | MUST | map | The voter's answers by question `id` (§4.1); MAY be empty |

The body is the voter's **note**: Markdown, and MAY be empty. Unknown top-level
keys are preserved (02 §2.4) — `status` among them: only `poll.md` is forbidden
it, and a vote carrying one is not at fault.

An empty `answers` (`answers: {}`) is a **withdrawal**: the voter takes back
their earlier ballot and answers nothing.

A vote is never edited. Voting again writes a new file; the old one stays, and
is what the history of somebody's opinion is made of. A file name records the
second, so a tool writing a vote stamps it at least a second after the same
voter's latest valid vote in that poll, whatever its clock says: one person's
votes then sort in the order they were cast. A vote stamped more than five
minutes ahead of the tool's clock is the exception, and is not one it stamps
after (§3.2).

### 4.1 Answers

Each value of `answers` is a map:

| Key | Req. | Type | Meaning |
|-----|------|------|---------|
| `picks` | MUST | list of slugs | The options chosen, by `id`; MAY be empty when `other` is given |
| `other` | MAY | string | The write-in; one line, not empty |

These faults are judged from the file alone, whatever the poll says:

- a key of `answers` that is not a slug, or a value that is not a map;
- a missing `picks`, or one that is not a list of slugs; a slug picked twice;
- an `other` that is empty, only whitespace, or contains a line break (§3.1);
- an answer with no picks and no `other` (skip a question by leaving it out);
- a key in an answer other than `picks` and `other`.

These are judged against the poll's questions, and only when the vote's
`fingerprint` is the poll's current one — a revoked ballot (§5) answered
questions that no longer exist, and is not at fault for it:

- a key that names no question of the poll;
- a pick that names no option of its question;
- an `other` on a question without `other: true`;
- on a single-choice question, anything but exactly one answer: one pick, or a
  write-in and no pick;
- on a multiple-choice question, any number of picks, with or without a
  write-in, so long as there is at least one of either.

### 4.2 Limits

Everybody who opens an issue reads its polls, and every vote in them; a server
reads them for everybody who asks. Nothing in a poll needs to be large, and a
file made large on purpose would cost each of them the time it takes to read.
So a poll and a vote MUST NOT hold more than:

| What | At most |
|---|---|
| Questions in `questions` | 50 |
| Options in a question's `options` | 100 |
| Answers in a vote's `answers`, or in `decision` | 50 |
| Picks in an answer's `picks` | 100 |
| `title`; an option's `label` | 200 characters |
| A question's `text`; a write-in (`other`) | 500 characters |
| An option's `description` | 4,000 characters |
| A vote's note (its body); `decision-note` | 10,000 characters |
| The preamble (the body of `poll.md`) | 20,000 characters |

- A character is a Unicode code point. A text is measured as it is read: a
  `description` without its trailing whitespace (§3.1), and a body or a
  `decision-note` without the blank lines that begin it and the whitespace
  that ends it.
- The counts of answers and picks are judged from the file alone, like the
  faults of the first list of §4.1. Picks are also no more than the options of
  the question they answer, since each names a different one.
- A list or a map over its limit is the fault, and a reader need not look at
  its entries: they are not read, and their own faults are not reported. A file
  made huge by hand then costs no more to read than one at the limit.
- A tool MUST NOT write a poll or a vote over a limit: it refuses the input
  that would make one, and says so. A refusal that lists faults lists a few and
  counts the rest.

## 5. The fingerprint

A ballot is only meaningful against the questions it answered. The
**fingerprint** names them: a vote records the fingerprint of the questions as
they were when it was cast, and a poll's current fingerprint is that of its
questions now. A ballot whose fingerprint differs from the poll's current one
is **revoked** (§6.1) — any change to the questions, from a new option to a
reworded label, revokes every ballot cast before it. Changing the title, the
preamble, `results` or `deadline` revokes nothing.

The fingerprint is the first 16 hexadecimal digits, lowercase, of the SHA-256 of
the UTF-8 encoding of the **canonical JSON** of the questions' **normal form**.

The normal form is the list of questions in order, each one the object

```
{ "id", "text", "multi", "other", "options" }
```

with `multi` and `other` as booleans (`false` when absent), and `options` the
list of options in order, each

```
{ "id", "label" }    or    { "id", "label", "description" }
```

— `description` only when the poll has one. Every string is as read (§3.1):
`text` and `label` untrimmed, `description` without its trailing whitespace.
Keys this document does not define are not part of it; there can be none in a
valid poll.

The canonical JSON is that of RFC 8785 restricted to these values: objects with
their keys sorted by UTF-16 code units, no whitespace anywhere, strings escaped
as ECMAScript's `JSON.stringify` escapes them, `true` and `false`.

The fingerprint of the questions in §3 is `494fd6745530e75d`.

## 6. What the votes say

Derived from the files, and never stored.

### 6.1 Ballots

1. A poll's **valid** votes are those with no fault of §4 or §4.1. A vote with a
   fault takes no part in what follows; `doctor` reports it (§8).
2. The votes are taken in file-name order, which is the order they were cast
   in. When the poll is closed by `closed`, a vote cast after that instant — by
   its file name's timestamp, to the second — is **late**: it takes no part.
3. Each voter's **ballot** is their latest vote. Voters are the same person
   when their addresses are the same, compared case-insensitively (02 §2.4).
   Every earlier vote of theirs is **superseded**.
4. A ballot is **withdrawn** when its `answers` is empty; otherwise **revoked**
   when its fingerprint is not the poll's current one; otherwise it
   **counts**. A revoked or withdrawn ballot is still its voter's latest
   word: an older ballot never comes back.

### 6.2 Status

A poll is **closed** when `closed` is set, or when its issue is closed; else
**open**. A poll its issue closed has no `closed` instant, so no vote on it is
late; and no decision was recorded, so its decision is the one its tallies come
to (§6.3).

### 6.3 Tallies and decisions

For each question, over the ballots that count:

- **answered**: how many of them answer it;
- for each option: how many pick it, and who;
- the write-ins: each `other`, with who wrote it;
- the **leaders**: the options with the most picks, when that is at least one.
  Write-ins never lead: each is in its writer's words, and two of them are not
  the same answer however alike they read.

A single-choice question with more than one leader is **tied**.

The decision a poll **comes to** — what a tool proposes when it is closed, and
what a poll its issue closed reads as — is, per question:

- single-choice: its leader, when there is exactly one; else none;
- multiple-choice: every leader; none when there is no leader.

A recorded `decision` is what the closer decided, and MAY differ from the
tallies: closing is a person's call, not arithmetic. A tool closing a poll
SHOULD propose the decision it comes to, and MUST NOT record one for a tied
question unless the closer chose.

### 6.4 Results

`results` says when a front end shows a poll's tallies — not who can read them,
since everybody can (§1):

- `hidden`: once the person looking has a ballot that counts, or the poll is
  closed. Before that, a front end SHOULD offer to show them on request, and
  MUST say they are hidden rather than show none.
- `visible`: always.

The point is anchoring: a person who sees the leader before forming a view is
voting on the leader. A machine-readable projection (`--json`, an API) is not a
front end in this sense, and carries the tallies regardless.

## 7. What a tool without this plugin does

A tool that does not know this plugin MUST preserve `poll/` inside every issue
directory, and MUST NOT interpret it (02 §2.12). Closing, reopening, archiving
and deleting an issue carry its polls with its directory, and `doctor` reports
nothing about them.

## 8. Checks

Numbered in the extension series of spec 04 §4.3.

- **X-poll-1** (error) — the layout of §2 and every fault of §3, §3.1, §3.2,
  §4, §4.1 and §4.2: a file directly in `poll/`, a poll directory whose name
  does not follow the grammar or that has no `poll.md`, an `.md` file beside
  `poll.md` that is not a vote, and every schema fault of a poll or a vote. A
  vote in a directory with no `poll.md` to read — missing, or not readable as
  one — is still checked for every fault judged from the file alone.
- **X-poll-2** (warning) — what a race, a wrong clock or a hand edit explains:
  a vote cast after its poll was closed, which takes no part (§6.1); and a
  valid vote stamped more than five minutes after the moment the check runs,
  which a tool closing the poll does not wait for (§3.2).
- **X-poll-3** (error) — a poll or vote ID that is also another poll's or vote's,
  an entity's or a comment's; a vote beside no readable `poll.md` included.
  Check D3 does not see them, so this is its counterpart.

A revoked ballot is not a fault: it is what editing a poll does.

## 9. Commits

A change this plugin makes uses the scope `poll` (spec 03 §3.2):

| Change | Subject |
|---|---|
| Open a poll | `docs(poll): open <poll id> on #<issue id>` |
| Edit it | `docs(poll): edit <poll id> on #<issue id>` |
| Vote | `docs(poll): vote <poll id> <vote id> on #<issue id>` |
| Withdraw a vote | `docs(poll): withdraw <poll id> <vote id> on #<issue id>` |
| Close it | `docs(poll): close <poll id> on #<issue id>` |
| Reopen it | `docs(poll): reopen <poll id> on #<issue id>` |

Every change carries a `Refs: <issue id>` trailer. A poll's or a vote's ID is
written bare, never as `#<id>`: references resolve to entities and comments
(02 §2.9), and neither is one.

## 10. Settings

None. The declaration is an empty object:

```json
{
  "version": 1,
  "plugins": {
    "@navbook/plugin-poll": {}
  }
}
```
