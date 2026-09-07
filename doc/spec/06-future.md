# 6. Future directions (reserved, non-normative)

None of the following changes the v1 format. This chapter exists so that v1
files never need migration when these arrive: the format reserves the names and
shapes below, and v1 tools already MUST preserve them untouched
([02 §2.4, §2.10](02-data-model.md)).

One of them has since been built. [§6.3](#63-web-client-built) stays here rather
than moving to [05](05-implementation.md), because this is where its design was
argued and because the argument is still the useful part: what the web client
may and may not do is decided by the principles below, not by what happened to
be convenient to write. It is marked as built, and reads in the present tense.

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

One of those exists: the API server of [§6.3](#63-web-client-built) is the web
form, and it behaves as described here — identity from a bearer token, `author:`
the person, committer the machine account. The bot, the Action and the email
ingester remain reserved, and the design is written once here rather than
per-gateway because it is the same design each time.

## 6.3 Web client (built)

A browser interface so that filing an issue, commenting and reviewing do not
require a terminal — the audience is everyone on a project who is not working
from a checkout. Two packages: `@navbook/server`, the API, and `@navbook/web`,
the client ([05 §5.2](05-implementation.md)).

The design principles were fixed before either existed, and holding to them is
what keeps the format from acquiring a second implementation by accident:

- **A server, not a browser build.** The web client is a thin UI over an API
  server (GraphQL) that imports `@navbook/core`
  ([05 §5.2](05-implementation.md)) and runs the same operations the CLI runs.
  Nothing about the format is reimplemented for the web, and no Navbook logic
  ships to the browser: the client sends fields, and the server composes the
  files. What reaches the browser is the canonical JSON projection of
  [04 §4.2](04-cli.md), so a reader of the API and a reader of `nav --json`
  are looking at the same thing.
- **The server owns a clone, not a database.** It works against its own
  server-side checkout, synchronised with a central origin — pull before an
  operation, push after it. Git remains the single source of truth and the
  only durable state; the clone is a working copy that can be thrown away and
  made again. Nothing index-like is introduced ([§6.6](#66-explicitly-rejected-directions)).
  The client inherits that: with no index there is no cursor, so a listing is
  the whole matching set and paging is the browser's own affair.
- **Read *and* write.** This is the substantive change from a viewer: the
  server commits on a signed-in person's behalf, which is precisely the
  non-committer gateway of [§6.2](#62-non-committer-gateway) — `author:` records
  the person, the committer is the gateway, and that is why `author` is data
  rather than derived. Contention with concurrent CLI users is handled by the
  ordinary merge rules of [03 §3.3](03-merge-and-branches.md); the server gets
  no privileged path.
- **Conflicts surface, they are not resolved.** A push the server cannot
  fast-forward is reported to the person who made the change, not merged
  heuristically on their behalf. So is a change that was committed to the
  clone but not pushed: it exists nowhere anyone else can pull from, and a
  client that reported it as saved would be lying about where the work went.

Two consequences worth recording, because both are refusals rather than
omissions.

**Specification documents are edited in the browser, and a stale write is
refused.** A feature's documents ([02 §2.11](02-data-model.md)) are prose people
work on together, so the client reads and writes them; what it sends is still
fields, and the server still composes the file. A save carries the hash the
editor started from, and a save whose file has moved on since is refused rather
than landed on top of somebody else's paragraph. That is the rule above applied
to a document instead of a push: conflicts surface, they are not resolved.

**The checkout-centric verbs are not exposed.** Opening a pull request,
appending a revision to one, merging it, deleting an entity, `init`, and
`doctor --fix` need a branch and a working tree rather than a request, and a
gateway performing them would be making decisions on somebody's behalf that
they could not see. `doctor` is read-only over the API. Editing a pull
request's *metadata* is not on that list: asking somebody to review, or
relabelling, is a patch to one file and nothing else, so it is exposed exactly
as an issue's is.

**A pull request can be visible and still not writable.** Its files live on
the branch it proposes to merge ([03 §3.5](03-merge-and-branches.md)), so a
cross-ref scan finds ones the serving checkout does not hold. Writing a comment
beside a `pr.md` that is not there would produce the stranded comment of
[03 §3.3.1](03-merge-and-branches.md) — and there is no `pr.md` there to patch
either — so the server refuses and names the branch that would have to be
served instead.

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
