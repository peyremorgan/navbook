# 2. Data model (normative)

This document specifies the on-disk format. A repository conforms to this
specification if its `.navbook/` tree satisfies every MUST below. Tools MUST NOT
require any file or structure beyond what this document defines, and MUST
tolerate (preserve, never delete or reorder) anything they do not understand.

## 2.1 Directory layout

```
.navbook/
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
└── prs/
    ├── open/
    │   └── dk3mp2x9-auth-refactor/
    │       ├── pr.md
    │       └── comments/
    │           └── 2026-08-05T101433Z-q8zm3vp1.md
    ├── merged/
    └── closed/
```

- The root directory MUST be named `.navbook` and sit at the repository root.
- `issues/` MUST contain only the subdirectories `open/` and `closed/`.
- `prs/` MUST contain only the subdirectories `open/`, `merged/`, and `closed/`.
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
| `resolution` | MAY | string | Meaningful for closed issues: `fixed`, `wontfix`, `duplicate`, `invalid` RECOMMENDED; free-form allowed |
| `duplicate-of` | MAY | ID | With `resolution: duplicate` |
| `parent` | MAY | ID | The issue this one is a subtask of |
| `subtasks` | MAY | list of IDs | The issues filed under this one, in the order they should be read |

The Markdown body after the frontmatter is the description. It MUST NOT be
empty. There is no `id` key (the directory name is authoritative — a copied
file cannot carry a stale ID) and no status key (the path is authoritative).

### Decomposition

`parent` and `subtasks` record that one issue breaks another down. Both sides
of a link are written, deliberately: either file answers its own question
without opening the other, which is what keeps a listing or a `show` one read
rather than a graph traversal.

- The two sides MUST agree. An issue named in a `subtasks` list MUST name that
  issue in its `parent`, and vice versa; `doctor` check D11 reports a
  disagreement. A link whose target is not in the tree is exempt: it may live
  on a branch nobody has fetched, which is D8's business (§2.9).
- `parent` holds at most one ID. That is what makes decomposition a tree rather
  than an arbitrary graph, and it makes `parent` the authoritative side: an
  issue is a subtask of another when it says so.
- The chain of `parent` links MUST NOT loop, in particular an issue MUST NOT
  name itself in either key (`doctor` check D12). Depth is otherwise unbounded:
  a subtask may have subtasks of its own.
- A `subtasks` list MUST NOT name the same issue twice, and SHOULD be written
  in flow style (`subtasks: [mz4kq1rv, w2rfk8na]`) as the examples above are. An
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
| `verdict` | MAY | `approve` \| `request-changes` | Makes this comment a review |
| `revision` | MUST if `verdict` or `file` present | 40-hex SHA | The revision `head` ([2.7](#27-prmd)) this review or anchor refers to |
| `file` | MAY | repo-relative path | Inline comment anchor |
| `line` | MAY | integer or `start-end` range | Line(s) in `file` at commit `revision` |

A verdict applies only to the exact `revision` named. Later revisions carry no
approvals until re-reviewed — this rule is what prevents a force-push from
inheriting a stale approval. Inline comments SHOULD quote the code they discuss
in the body (blockquote), so they remain meaningful to humans even after the
anchor drifts.

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
| `labels`, `assignee`, `milestone` | MAY | as issues | |
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

## 2.8 PR lifecycle

1. **Open** — the author commits `.navbook/prs/open/<id>-<slug>/` on the source
   branch, with one revision entry. Publishing the branch publishes the PR.
2. **Iterate** — new reviewable states append revisions; discussion and reviews
   accumulate as comment files, all on the source branch.
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

Future revisions of this spec may define: `.navbook/config.*` (repository-level
configuration), `.navbook/sync/` (forge-sync state), and additional files
inside entity directories. Tools MUST leave unrecognized files in these
locations untouched.
