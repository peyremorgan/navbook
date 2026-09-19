# 2. Data model (normative)

This document specifies the on-disk format. A repository conforms to this
specification if its `.navbook/` tree satisfies every MUST below. Tools MUST NOT
require any file or structure beyond what this document defines, and MUST
tolerate (preserve, never delete or reorder) anything they do not understand.

## 2.1 Directory layout

```
.navbook/
├── navbook.json
├── issues/
│   ├── open/
│   │   └── bqlybac0-login-timeout/
│   │       ├── issue.md
│   │       └── comments/
│   │           ├── 2026-08-03T141207Z-t5kr1gq6.md
│   │           └── 2026-08-04T093012Z-w2rfk8na.md
│   └── closed/
│       └── mz4kq1rv-crash-on-empty-file/
│           └── issue.md
├── prs/
│   ├── open/
│   │   └── dk3mp2x9-auth-refactor/
│   │       ├── pr.md
│   │       └── comments/
│   │           └── 2026-08-05T101433Z-q8zm3vp1.md
│   ├── merged/
│   └── closed/
└── specs/
    └── auth/
        ├── feature.md
        └── login-flow.md
```

- The root directory MUST sit at the repository root. Its name defaults to
  `.navbook`; a repository MAY use another name, and one that does MUST carry a
  `navbook.json` **marker** (§2.10) at the top of the directory so the directory
  can be located.
- Tools MUST locate the root directory by looking for `.navbook/` first, and,
  failing that, for a directory carrying the marker. Finding more than one
  candidate MUST be reported as an error rather than resolved by guessing; a
  tool MAY offer its own way to name the directory explicitly, and such a
  mechanism MUST take precedence over this search.
- All paths a tool reports are relative to the repository root, and therefore
  begin with the directory's actual name rather than with `.navbook/`.
- `issues/` MUST contain only the subdirectories `open/` and `closed/`.
- `prs/` MUST contain only the subdirectories `open/`, `merged/`, and `closed/`.
- `specs/` holds features (§2.11). It is OPTIONAL: a repository with no
  features has none, and tools MUST create it only when a feature is created.
- Status subdirectories contain zero or more **entity directories** and nothing
  else. An entity directory under `issues/` MUST contain an `issue.md`; under
  `prs/`, a `pr.md`. Either MAY contain a `comments/` directory. Tools MUST
  ignore unknown extra files inside entity directories (reserved for future
  revisions) and MUST preserve them across operations.
- An entity's **status is its path**. Moving the directory between status
  subdirectories is the only way status changes. Entity files MUST NOT contain a
  status field.

## 2.2 Identifiers

Every entity (issue, PR) and every comment has an **ID**:

- Grammar: `^[a-z][a-z0-9]{7}$` — exactly 8 characters, first character a
  letter, and the ID MUST contain at least one digit.
- Generation: 8 characters chosen uniformly at random from the allowed alphabet
  (rejecting candidates that violate the grammar), using a cryptographically
  seeded generator. No coordination, counter, or registry is involved; offline
  and parallel creation is safe by construction.
- An ID is minted once and MUST never change for the life of the entity.
- IDs MUST be unique within a repository across all entity and comment IDs,
  in both live and archived states. Given ≥ 40 bits of entropy, a collision is
  treated as data corruption: `nav doctor` detects it; tools MUST NOT
  attempt automatic repair.

Rationale for the grammar: a leading letter prevents YAML from parsing an ID as
a number, and the mandatory digit prevents any English word (`feedback`) from
being mistaken for an ID by searches and validators.

**Prefix matching.** Wherever a CLI accepts an ID, it MUST accept any
unambiguous prefix of length ≥ 4.

## 2.3 Entity directory names

```
<id>-<slug>       e.g.  bqlybac0-login-timeout
```

- The name MUST match `^[a-z][a-z0-9]{7}-[a-z0-9]+(-[a-z0-9]+)*$`.
- The **slug** SHOULD be derived from the title (lowercased, non-alphanumerics
  collapsed to single hyphens) and SHOULD be at most 50 characters.
- The slug is display-only. It MAY be renamed (e.g. after retitling); the ID
  portion MUST NOT change. References resolve by ID alone, so renames are safe.

## 2.4 Common file conventions

- All files are UTF-8 Markdown beginning with a YAML frontmatter block
  delimited by `---` lines, starting at byte 0. Frontmatter is required in
  every Navbook file (each file type has required keys below).
- **Unknown frontmatter keys MUST be preserved** by tools when rewriting a file.
  Keys are lowercase kebab-case. Keys beginning with reserved names in
  [06-future.md](06-future.md) (`imported-from`, `imported-at`) carry sync
  provenance and MUST be treated as opaque.
- **Timestamps** in frontmatter are ISO 8601. UTC (`Z` suffix) is RECOMMENDED.
  Frontmatter timestamps are display data; where ordering or authority matters,
  git history governs.
- **People** are RFC 5322 addresses: either `alice@example.com` or
  `Alice Smith <alice@example.com>`. The email address is the identity key;
  the display name is presentation. Tools comparing identities MUST compare
  the address case-insensitively and SHOULD honor `.mailmap` if present.

## 2.5 `issue.md`

```markdown
---
title: Login times out on slow connections
author: Alice Smith <alice@example.com>
created: 2026-08-02T09:14:00Z
labels: [bug, auth]
assignee: ked@example.com
---

Login POST aborts after 5 s on 3G-class connections.
The server never sees the request.
```

| Key | Req. | Type | Meaning |
|-----|------|------|---------|
| `title` | MUST | string | One-line summary |
| `author` | MUST | person | Who filed the issue (may differ from git committer, e.g. filed on someone's behalf) |
| `created` | MUST | timestamp | Filing time |
| `labels` | MAY | list of strings | Free-form; kebab-case RECOMMENDED |
| `assignee` | MAY | person or list of persons | Who owns the work |
| `milestone` | MAY | string | Free-form grouping |
| `feature` | MAY | slug or list of slugs | The feature(s) this issue belongs to (§2.11) |
| `rank` | MAY | number | Relative priority; lower sorts first |
| `deadline` | MAY | date | When the work is wanted, `YYYY-MM-DD` |
| `resolution` | MAY | string | Meaningful for closed issues: `fixed`, `wontfix`, `duplicate`, `invalid` RECOMMENDED; free-form allowed |
| `duplicate-of` | MAY | ID | With `resolution: duplicate` |
| `parent` | MAY | ID | The issue this one is a subtask of |
| `subtasks` | MAY | list of IDs | The issues filed under this one, in the order they should be read |

The Markdown body after the frontmatter is the description. It MUST NOT be
empty. There is no `id` key (the directory name is authoritative — a copied
file cannot carry a stale ID) and no status key (the path is authoritative).

### Priority and deadline

`rank` and `deadline` say where work sits in a queue and when it is wanted.

- `rank` is a number, and lower sorts first. It is a position rather than a
  grade: what it records is that one issue comes before another, so the values
  mean nothing beyond their order and the gaps between them, and any finite
  decimal is one — negative values included. A whole value SHOULD be written as
  an integer.
- Placing an issue MUST rewrite only the issue that moved. A value between two
  neighbours' puts it between them, and one clear of either end puts it past
  that end; halving the gap is the obvious way to find the first. Renumbering a
  listing to keep the values tidy is the central index of §6.6 spread over
  every file instead of gathered into one, and is exactly as much of a conflict
  magnet.
- `deadline` is a calendar date written `YYYY-MM-DD`, with no time and no zone.
  A day is what a due date means, and it is the one spelling that two readers
  in different places cannot disagree about. It MAY be in the past: a deadline
  that was missed is information rather than a fault.
- Both keys are issue-only, for the reason the two below are. A pull request is
  a proposed change rather than a unit of work to schedule, and what orders a
  review queue is the state of §2.7; carrying either key on `pr.md` is a schema
  fault.

Ordering remains a reading of the files and never a stored order. The listing
order of [04 §4.2](04-cli.md) is newest first and stays so. A front end MAY
offer to sort by what these keys say, and the orders it offers are then:

| Order | Reads |
|-------|-------|
| `priority` | `rank` ascending, unranked last; then `deadline` ascending, undated last; then newest first |
| `deadline` | `deadline` ascending, undated last; then `rank` ascending, unranked last; then newest first |
| `newest` | `created` descending — §4.2's order |

Each of them breaks a remaining tie on the ID, so the ordering is total and two
tools sorting one listing agree about it.

### Decomposition

`parent` and `subtasks` record that one issue breaks another down. Both sides
of a link are written, deliberately: either file answers its own question
without opening the other, which is what keeps a listing or a `show` one read
rather than a graph traversal.

- The two sides MUST agree. An issue named in another's `subtasks` list MUST
  name that other issue in its own `parent`, and an issue's `parent` MUST list
  it back; `doctor` check D11 reports a disagreement. A link whose target is
  not in the tree is exempt: it may live on a branch nobody has fetched, which
  is D8's business (§2.9).
- `parent` holds at most one ID. That is what makes decomposition a tree rather
  than an arbitrary graph, and it makes `parent` the authoritative side: an
  issue is a subtask of another when it says so.
- The chain of `parent` links MUST NOT loop, in particular an issue MUST NOT
  name itself in either key (`doctor` check D12). Depth is otherwise unbounded:
  a subtask may have subtasks of its own.
- A `subtasks` list MUST NOT name the same issue twice, and SHOULD be written
  in flow style (`subtasks: [mz4kq1rv, w2rfk8na]`), as `labels` is above. An
  issue with no subtasks omits the key rather than writing an empty list.
- Both keys are issue-only. A pull request is a proposed change, not a unit of
  work to break down, so carrying either key on `pr.md` is a schema fault, and
  so is an issue whose link names a pull request.
- Deleting an issue does not delete what was filed under it: unless the
  deletion is explicitly recursive, its subtasks survive as top-level issues.

## 2.6 Comments

Comments live in the entity's `comments/` directory, one file per comment:

```
comments/2026-08-03T141207Z-t5kr1gq6.md
```

- Filename grammar: `^\d{4}-\d{2}-\d{2}T\d{6}Z-[a-z][a-z0-9]{7}\.md$` — a UTC
  timestamp (date, `T`, `HHMMSS`, `Z`; no colons, so names are valid on every
  filesystem) followed by the comment's ID. Files therefore sort
  chronologically in any directory listing.
- The timestamp is the comment's creation time in UTC. The ID portion is the
  comment's identity for `reply-to:` and `#` references.

```markdown
---
author: alice@example.com
---

Reproduced on staging — traced to the LB idle timeout, not the client.
```

| Key | Req. | Type | Meaning |
|-----|------|------|---------|
| `author` | MUST | person | Comment author |
| `reply-to` | MAY | comment ID | The comment this replies to (same entity). Threads are flat files; renderers MAY indent by `reply-to` chains |

Editing a comment is editing its file; git history is the edit record. Deleting
a comment is deleting its file (discouraged; prefer a follow-up comment — the
content remains in history either way).

### Review fields (comments on PRs)

A comment on a PR MAY additionally carry:

| Key | Req. | Type | Meaning |
|-----|------|------|---------|
| `verdict` | MAY | `approve` \| `request-changes` \| `comment` | Makes this comment a review |
| `revision` | MUST if `verdict` or `file` present | 40-hex SHA | The revision `head` ([2.7](#27-prmd)) this review or anchor refers to |
| `file` | MAY | repo-relative path | Inline comment anchor |
| `line` | MAY | integer or `start-end` range | Line(s) in `file` at commit `revision` |

A verdict applies only to the exact `revision` named. Later revisions carry no
approvals until re-reviewed — this rule is what prevents a force-push from
inheriting a stale approval. Inline comments SHOULD quote the code they discuss
in the body (blockquote), so they remain meaningful to humans even after the
anchor drifts.

`approve` and `request-changes` are **opinionated**: they judge the revision.
`comment` judges nothing and says only that its author read the revision named
— it is what a reviewer files when they have looked and have nothing to
withhold or demand. It is still a review, and it still binds to a revision, so
it satisfies a request for review ([2.7](#27-prmd)) exactly as the other two
do; it is simply never counted for or against the change.

A `comment` verdict is not the same as a comment with no verdict at all. The
latter is discussion, bound to nothing, and a tool that recorded it as a review
would be claiming its author had read a revision they may never have opened.

**A tool that predates this key's third value will reject a `comment` verdict
as malformed.** Nothing else about such a file is new, so this is the only
compatibility cost of the addition, and it is why `comment` is a value of an
existing key rather than a key of its own: the alternative would have older
tools silently reading a review as discussion.

```markdown
---
author: alice@example.com
verdict: request-changes
revision: 4f2c9d1e8a7b3c5d9e0f1a2b3c4d5e6f7a8b9c0d
file: src/auth/login.c
line: 142
---

> if (timeout > 5)

Off-by-one: should be `>=`.
```

## 2.7 `pr.md`

```markdown
---
title: Refactor auth token handling
author: ked@example.com
created: 2026-08-04T16:40:00Z
target: main
source: feat/auth-refactor
reviewer: alice@example.com
revisions:
  - head: 4f2c9d1e8a7b3c5d9e0f1a2b3c4d5e6f7a8b9c0d
    base: 91d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0
    date: 2026-08-04T16:40:00Z
---

Replaces the ad-hoc token cache with per-session storage.
Closes: bqlybac0
```

| Key | Req. | Type | Meaning |
|-----|------|------|---------|
| `title` | MUST | string | One-line summary |
| `author` | MUST | person | Who opened the PR |
| `created` | MUST | timestamp | Opening time |
| `target` | MUST | string | Branch this PR asks to merge into |
| `source` | SHOULD | string | Branch the PR rides on (informative; the PR directory itself lives on that branch) |
| `revisions` | MUST, ≥ 1 entry | list | Append-only history of reviewable states |
| `draft` | MAY | boolean | Not yet requesting review |
| `reviewer` | MAY | person or list of persons | Who is asked to review (below) |
| `labels`, `assignee`, `milestone`, `feature` | MAY | as issues | |
| `merged` | MAY | map | Added at/after merge: `date`, `by` (person), `commit` (40-hex merge commit, added in a follow-up commit since it cannot be known inside the merge itself) |
| `resolution` | MAY | string | For `prs/closed/`: `declined`, `superseded`, `abandoned` RECOMMENDED |
| `superseded-by` | MAY | ID | With `resolution: superseded` |

Each `revisions` entry:

- `head` (MUST): 40-hex commit SHA of the state offered for review.
- `base` (MUST): 40-hex merge-base with `target` at that time.
- `date` (MUST): timestamp of the entry.

Entries MUST only be appended, never edited or removed. Amending or
force-pushing the source branch is represented by appending a new entry. The
branch name in `source` is intent; the SHAs are truth.

### Review requests

`reviewer` names the people a pull request asks to review it. It takes the
shape `assignee` takes (§2.5) — one person written as a scalar, several as a
list — and it is the whole of the request: **being listed is being asked.**

There is deliberately no second key recording whether a request is still
outstanding. Such a key would have to be cleared by the reviewer's own commit,
so every review would rewrite `pr.md` and race whatever the author was editing
there (§3.3) — a conflict manufactured by the format, in the one file two
people are most likely to touch at once. A review is a new file, and it stays
one.

What is outstanding is therefore **derived**, not stored, and the reviews
themselves are what it is derived from:

- A person's **state** on a revision is their latest opinionated verdict
  (§2.6) among the reviews they bound to it; failing that, `commented` if they
  bound a `comment` verdict to it; failing that, `pending`. "Latest" is by
  comment filename (§2.6), which is the order the thread itself renders in, so
  what a reader sees and what a tool computes can never disagree — including
  for two reviews written inside the same second, which the timestamp cannot
  separate and the ID therefore orders.
- A pull request's state is read on its **latest revision**, so appending a
  revision returns every reviewer to `pending` — the same rule that stops a
  verdict carrying forward, seen from the other side. Re-requesting a review
  after a force-push is thus not an action anyone has to remember to take.
- A **decision** for the whole pull request is `changes-requested` when any
  person's state is `request-changes`, otherwise `approved` when at least
  `minApprovals` people's state is `approve`, otherwise `pending`.
- The people considered are those `reviewer` names **and** anyone else who has
  bound a verdict to that revision: a review nobody asked for is still a
  review. The pull request's own `author` is excluded throughout, from the
  listing and from the decision alike, unless `selfReview` says otherwise.

`minApprovals` and `selfReview` are the **review policy**, which the marker
declares (§2.10). A repository that declares none is read with the defaults,
one approval and no self-review, which are the rule stated above without them.

Nothing here is a gate. A decision of `pending` does not make a merge wrong,
and `approved` does not make one right; both are readings of what the files
say, and merge policy belongs to the forge or to team convention ([01
§1.7](01-functionality.md)). A tool MUST NOT refuse an operation on the
strength of a derived review state, and MUST NOT write any of these states
into a file. A declared policy changes what the reading counts, and what a
tool may say about it; it never changes what a tool will do.

`draft` and `reviewer` are independent: a draft may name the people it will
ask, and one that does is still not asking.

## 2.8 PR lifecycle

1. **Open** — the author commits `.navbook/prs/open/<id>-<slug>/` on the source
   branch, with one revision entry. Publishing the branch publishes the PR.
2. **Iterate** — new reviewable states append revisions; discussion and reviews
   accumulate as comment files, all on the source branch. Asking someone to
   review is an edit to `reviewer` on `pr.md`; answering is a comment file, and
   never an edit to `pr.md` (§2.7).
3. **Merge** — the source branch is merged into `target`; the PR directory is
   moved to `prs/merged/` either inside the merge commit or in an immediate
   follow-up on the target branch. The full discussion is thereby archived in
   the target's history. The `merged:` block SHOULD be recorded.
4. **Decline / abandon** — the branch is simply never merged. To keep a durable
   record, a maintainer MAY commit the PR directory to `prs/closed/` on the
   default branch (e.g. by checking out the directory from the source branch)
   with a `resolution:`.

## 2.9 References

- **In prose** (issue bodies, comments, PR descriptions): `#<id>`, e.g.
  "duplicate of #mz4kq1rv". Since `#` opens a heading at line start in
  Markdown, references SHOULD appear mid-line or use a trailer instead.
- **In commit messages**: git trailers with bare IDs —
  `Refs: bqlybac0` (relates to), `Closes: bqlybac0` (this change resolves it).
  Trailers document intent and power tooling (e.g. the CLI offering to perform
  the corresponding close), but they MUST NOT be treated as state changes:
  state changes only by files moving in the tree.
- **In frontmatter**: `duplicate-of`, `superseded-by`, `parent` and each entry
  of `subtasks` hold a bare ID.
- References resolve by searching entity directory names and comment filenames
  for the ID across all status directories. A reference whose ID matches no
  file is *dangling*; `doctor` warns but dangling references are not an error
  (the target may live on an unfetched branch).

## 2.10 Reserved names

`navbook.json`, at the top of the root directory, is the **marker**: its
presence is what identifies the directory that contains it as a Navbook root
(§2.1). It MUST be a JSON object. This revision defines three keys, `version`,
whose value MUST be the integer `1`, `review`, the review policy below, and
`plugins`, the declaration of §2.12; tools MUST ignore keys they do not
recognize, and MUST NOT reject a marker for carrying them.

A tool MUST NOT require the marker in order to read a `.navbook/` directory: a
repository using the default name and predating this revision has none, and
remains conforming. A tool that creates a root directory MUST write a marker
into it, so that a repository which later renames the directory stays
locatable.

### The review policy

`review`, when present, MUST be an object. It says how the reviews of §2.7 are
counted, and it is the one thing in the marker a tool reads rather than merely
finds.

```json
{
  "version": 1,
  "review": {
    "selfReview": false,
    "minApprovals": 2
  }
}
```

| Key | Req. | Type | Default | Meaning |
|-----|------|------|---------|---------|
| `selfReview` | MAY | boolean | `false` | Whether a pull request's own author is counted among its reviewers (§2.7) |
| `minApprovals` | MAY | integer ≥ 1 | `1` | How many approvals a decision of `approved` takes |

The defaults are what §2.7 describes without a policy, so a repository that
declares none, and one that predates this revision, are read identically.

A malformed policy is a fault in the marker, not in the tree it marks, and a
tool MUST report it (check D15 of [04 §4.3](04-cli.md)) rather than act on it.
Each key falls back to its default independently, and a marker that is not JSON
at all falls back to both: whatever is wrong with a file that names a
directory, the entities inside it are still readable, and a listing that
refused to run would say less than a listing with a warning on it.

**A policy is advisory.** It changes what the decision of §2.7 counts, and
therefore what every reading of that decision reports, and a tool MAY say that
a policy is unmet wherever saying so is useful. It remains subject to §2.7: no
tool refuses an operation because of it.

`specs/`, at the top of the root directory, holds features (§2.11).

Future revisions of this spec may define: `.navbook/config.*` (configuration
beyond what the marker carries), `.navbook/sync/` (forge-sync state), and
additional files inside entity directories. Tools MUST leave unrecognized files
in these locations untouched.

A top-level directory this specification does not name is an **extension
namespace** (§2.12) and MUST be preserved untouched by a tool that does not
recognize it — which is the same rule, stated for a directory the *marker* may
explain rather than a future revision of this document.

## 2.11 Features and specifications

A **feature** is a standing concept that work attaches to: a business vertical,
an open-ended goal, or a body of work too large to be one issue. It is
described by one or more Markdown documents and named by issues and pull
requests, and it is the one thing in this format that is neither an entity nor
a bare frontmatter string.

```
specs/
└── auth/
    ├── feature.md
    ├── login-flow.md
    └── session-policy.md
```

- Each subdirectory of `specs/` is one feature. Its name MUST match
  `^[a-z0-9]+(-[a-z0-9]+)*$` — the slug grammar of §2.3 without the ID — and
  that name is the feature's identity: it is what `feature:` names, and what a
  tool accepts wherever a feature is expected.
- A feature directory MUST contain a `feature.md`. Every other `*.md` in it is
  a **specification document**. Anything else it holds — subdirectories,
  images, loose text — MUST be preserved untouched and MUST NOT be interpreted.
- `specs/` MUST NOT contain files directly.

A feature has **no ID and no status**. It has no ID because its name is what
refers to it, and an opaque eight characters in an issue's frontmatter would
be unreadable exactly where the format is meant to be read. It has no status
because a standing concept does not open and close: the work attached to it
does, and that is what a tool counts.

### `feature.md`

```markdown
---
title: Authentication
author: Alice Smith <alice@example.com>
created: 2026-09-01T10:00:00Z
---

Everything about signing in, sessions and tokens.
```

| Key | Req. | Type | Meaning |
|-----|------|------|---------|
| `title` | MUST | string | The feature's name, for display |
| `author` | MUST | person | Who introduced it |
| `created` | MUST | timestamp | When it was introduced |

The body is a summary and MAY be empty: a feature is named by its title and
described by the documents beside it.

There is no key listing the issues that belong to the feature, deliberately.
Membership is asserted by the entity alone (below), so two people attaching two
issues write two different files and can never conflict — the same reasoning
that rules out a central index ([06 §6.6](06-future.md)).

### Specification documents

```markdown
---
title: Login flow
---

## Requirements

The app SHALL abort a login attempt after 5 s.
```

| Key | Req. | Type | Meaning |
|-----|------|------|---------|
| `title` | MUST | string | The document's name, for display |
| `author` | MAY | person | Who wrote it |
| `created` | MAY | timestamp | When it was written |

A document is a living description of how something works or should work, not
a record of something that happened, so who wrote it and when are git's answer
to give and are optional here.

File names are unconstrained beyond ending in `.md`: a document written by hand
as `Login Flow.md` is conforming and MUST keep working. A tool that *creates* a
document SHOULD name it to the slug grammar above with a `.md` suffix, and MUST
NOT create one named `feature.md`.

### Attaching an entity to a feature

An issue or pull request names the features it belongs to in its own
frontmatter:

```yaml
feature: auth
feature: [auth, mobile]
```

- The value is one slug or a list of slugs, in the shape `assignee` takes
  (§2.5). One feature SHOULD be written as a scalar.
- A slug that names no directory in this tree is *dangling*, not an error:
  the feature may live on a branch nobody has fetched, exactly as a `#id`
  reference may (§2.9). `doctor` warns.
- The key is not restricted to issues. A pull request is work on something too,
  and a tool that shows a feature's history has an obvious use for it.

## 2.12 Extension namespaces

Not every project wants every feature, and a format that grew a section for
each would be a format nobody could implement twice. So this specification
reserves three namespaces that data defined **outside** it may occupy, and
fixes what a tool that does not understand such data MUST do with it. Nothing
here is a mechanism for loading code: that is a tool's affair
([04 §4.3](04-cli.md)). This section says only where extension data may live,
so that two implementations reading one tree agree about what they are looking
at and neither destroys what it cannot read.

An extension is identified by a **short name** matching `^[a-z][a-z0-9]*$`.
The three namespaces are:

| Namespace | Shape | Example |
|---|---|---|
| A top-level directory | `<short>/` at the top of the root directory | `.navbook/reports/` |
| Inside an entity directory | `<short>/` or `<short>.*` beside `issue.md` or `pr.md` | `.navbook/prs/open/dk3mp2x9-auth/reports.json` |
| A frontmatter key | `<short>-*` | `reports-latest:` |

- A tool MUST preserve what it finds in these namespaces: unchanged in the
  tree, and unchanged across any operation it performs on the entity that
  holds it. This is §2.4 and §2.1 applied to a directory the marker may name,
  and it is what lets somebody without the extension installed still close an
  issue, merge a pull request or run `doctor` without losing data.
- A tool MUST NOT interpret them. A frontmatter key it does not recognize is
  opaque (§2.4); so is a file.
- The namespaces do not nest into the shapes this specification does define.
  `issues/` and `prs/` still contain only their status subdirectories (§2.1),
  and a status subdirectory still contains only entity directories: an
  extension that wants a directory of its own takes one at the top.

An extension that defines data in any of these namespaces MUST publish a
specification for it, in the sense this document is one: what each file and
key means, which are required, and what a tool may conclude from them. A
reader of the tree can then find out what the data is, which is the property
§2.1 protects for everything else.

### Declaring them

`plugins`, in the marker (§2.10), is where a repository says which extensions
its tree uses. It MUST be a JSON object; each key names an extension and each
value MUST be an object carrying whatever settings that extension reads.

```json
{
  "version": 1,
  "plugins": {
    "@navbook/plugin-kb": {}
  }
}
```

The key is the extension's own name for itself, and for the reference
implementation that is the npm package that implements it
([04 §4.3](04-cli.md)). Nothing in this format requires an npm package, or any
particular kind of tool: the key is an identifier a reader can look up, and a
second implementation naming its extensions some other way is conforming so
long as the names agree.

The declaration is data about the tree, not instruction to a tool. A tool MUST
NOT treat the presence of a name here as permission to fetch or execute
anything; what it is for is that a clone can tell what its own tree contains,
and say so when something is missing. A tool that finds an extension namespace
the marker does not declare MUST still preserve it (above), and MAY say that it
is undeclared.

A malformed declaration is a fault in the marker rather than in the tree it
marks, and is reported exactly as a malformed review policy is (D15,
[04 §4.3](04-cli.md)): the entities remain readable, every reader falls back to
declaring nothing, and the fault is reported rather than acted on.

Settings under a name are **committed, shared and non-secret**: they travel to
every clone. An extension that needs a credential reads it from the
environment, where a tool's own configuration lives, and not from here.

### Two names this specification kept

`specs/` and the `feature:` key (§2.11) occupy the first and third namespaces
without matching their grammars, because they were specified before this
section existed and renaming them would break every repository using them.
They are **grandfathered**: this document continues to define them, and no
extension may claim either name. The reference implementation has moved their
*implementation* into an extension without moving their definition
([05 §5.2](05-implementation.md)), which is exactly the arrangement this
section is meant to make possible.
