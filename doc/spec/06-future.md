# 6. Future directions (reserved, non-normative)

None of the following is part of v1. This chapter exists so that v1 files never
need migration when these arrive: the format reserves the names and shapes
below, and v1 tools already MUST preserve them untouched
([02 §2.4, §2.10](02-data-model.md)).

## 6.1 Forge synchronization

A bidirectional bridge to GitHub/GitLab issues and PRs is the intended adoption
ramp (migrate gradually, not cold-turkey). Design principles fixed now:

- **Three artifacts per synced entity:** the local files, the remote state, and
  a committed **base snapshot** of the remote as of the last sync, stored under
  `.navbook/sync/<provider>/…` — so any clone can compute a three-way diff and
  detect conflicting edits instead of clobbering either side.
- **Provenance in frontmatter:** reserved keys `imported-from:` (a URL or
  `provider:owner/repo#number` locator) and `imported-at:` (timestamp) mark
  entities whose origin is a forge. Comment-level provenance uses the same keys.
- **Numbers are foreign keys:** forge issue numbers never become Navbook IDs;
  the mapping lives in the sync state, and prose references keep using `#id`.
- **Idempotent and incremental:** sync must be re-runnable after any
  interruption (checkpoint in the sync state), and a fresh clone must be able
  to continue a sync started elsewhere.

## 6.2 Non-committer gateway

Filing an issue must eventually not require push access. The reserved design is
a gateway that commits on the reporter's behalf: a bot, forge Action, web form,
or email ingester that validates input, creates the issue files with
`author:` set to the reporter (this is why `author` is data, not derived from
the committer), and pushes to the default branch or opens a PR with the new
issue. The 15-year-running precedent is ikiwiki/git-annex's CGI-to-commit
tracker.

## 6.3 Web viewer

A read-only local/hosted viewer (`nav serve`) rendering issues, PR
discussions, and boards from any checkout. It grows out of the TypeScript
implementation's `core/` ([05 §5.2](05-implementation.md)) and stays outside
the correctness path: it renders the files; it never owns state.

## 6.4 Cryptographic attestation

Git commit signatures already attest Navbook actions (an approval is a commit
by the approver). Possible strengthening, following Radicle and patatt:
per-file detached signatures for imported/relayed content whose committer is a
gateway rather than the author. Reserved frontmatter key: `signature:`.

## 6.5 Archiving

The `.navbook/archive/<year>/…` convention sketched in
[03 §3.6](03-merge-and-branches.md) becomes a CLI operation
(`nav archive --closed-before DATE`) once real repositories hit the scale
that needs it.

## 6.6 Explicitly rejected directions

Recorded so future contributors know these were considered, not overlooked:

- **Operation-log/CRDT storage** (git-bug, Radicle): perfect merges, zero
  browsability — the opposite bet to Navbook's. Adopt the *discipline*
  (append-only, deterministic resolution rules), never the machinery.
- **Hidden ref namespaces** (`refs/notes`, `refs/pull`): invisible to forges
  and to `ls`; discoverability failure killed git-appraise despite technical
  elegance.
- **Sequential issue numbers:** collide across branches; the single most
  repeated design mistake in this problem space.
- **A central index file** (registry of issues, next-ID counter, board
  state): every operation would touch it; it becomes a permanent conflict
  magnet. Anything index-like must be derived, disposable, and uncommitted.
