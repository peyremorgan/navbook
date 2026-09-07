# 1. Functionality

## 1.1 What Navbook is

Navbook is an issue and pull-request system whose entire state lives as plaintext
files inside the git repository it serves, on the same branch and history as the
code. There is no server, no database, and no hidden ref namespace. If you can
clone the repository, you have the complete tracker: every issue, every comment,
every review, at the exact state of the branch you checked out.

Three properties define it:

1. **Browsable.** Issues are Markdown files in human-named directories. Any forge
   file browser, any editor, `ls` and `cat` — all of them are complete Navbook
   clients for reading.
2. **Same history as the code.** A branch that fixes a bug also carries the commit
   that closes the issue. Merging the branch merges the state change. `git log`,
   `git blame`, and `git bisect` work on tracker state exactly as they do on code.
3. **Format-first.** The file convention specified in [02-data-model.md](02-data-model.md)
   is the product. The `nav` CLI automates chores (ID generation, listing,
   validation) but is never required: creating, commenting on, closing, and
   reviewing with nothing but a text editor and git is a first-class, supported
   workflow. No operation may exist that only the tool can perform correctly.

## 1.2 Who it is for

- **Small teams and solo maintainers** who want issues to survive forge outages,
  forge migrations, and forge lock-in — and to work offline.
- **Distributed / air-gapped workflows** where the repository is exchanged by
  push/pull, bundle, or email, and the tracker must travel with it.
- **AI coding agents**, which need durable, queryable task state inside the
  repository without API calls. Every Navbook operation an agent needs is a file
  read or write followed by a commit.

## 1.3 Core concepts

- **Issue** — a bug report, task, or feature request: a directory containing an `issue.md`
  (metadata + description) and zero or more comment files. An issue is *open* or
  *closed*, and its status is expressed by which directory it sits in.
- **Pull request (PR)** — a proposal to merge a source branch into a target
  branch: a directory containing a `pr.md` (metadata, pinned revisions,
  description) and comment files, some of which are reviews. A PR is *open*,
  *merged*, or *closed* (declined/abandoned).
- **Comment** — a Markdown file inside an issue's or PR's `comments/` directory.
  Review verdicts and inline code comments are comments with extra metadata.
- **Review** — a comment carrying a `verdict` bound to one of a PR's pinned
  revisions. Who was *asked* for one is `reviewer:` on the PR; who still owes
  one is derived from the reviews, never stored.
- **ID** — an 8-character random identifier minted at creation
  (e.g. `bqlybac0`). It never changes, is unique within the repository, and is
  the way issues, PRs, and comments are referenced from prose and commit
  messages (`#bqlybac0`).

## 1.4 What a user does

All workflows below have two equivalent forms: by hand (editor + git) or via the
CLI ([04-cli.md](04-cli.md)). The hand-editing form is shown to make the
format-first guarantee concrete; the CLI performs exactly these file operations.

### Open an issue

Create `.navbook/issues/open/<id>-<slug>/issue.md` with YAML frontmatter
(title, author, created) and a Markdown description. Commit.

```
$ nav issue open "Login times out on slow connections" --label bug
Created .navbook/issues/open/bqlybac0-login-timeout/  (#bqlybac0)
```

### Comment

Add a file under the issue's `comments/` directory named with a UTC timestamp
and a fresh comment ID, with your email in the frontmatter. Commit. Two people
doing this concurrently on different branches can never conflict.

```
$ nav issue comment bqlybac0 -m "Reproduced on staging; LB idle timeout."
```

### Break an issue down

Record `parent:` in the subtask's frontmatter and add its ID to the parent's
`subtasks:` list. Commit. Both halves are written because either file should
answer its own question; `nav doctor` reports it when they stop agreeing. A
subtask can be broken down in turn, to any depth.

```
$ nav issue open "Raise the LB idle timeout" --parent bqlybac0
Created .navbook/issues/open/mz4kq1rv-raise-the-lb-timeout/  (#mz4kq1rv)
Filed under #bqlybac0  Login times out on slow connections

$ nav issue show bqlybac0
...
subtasks:  #mz4kq1rv Raise the LB idle timeout (open)
```

### Close / reopen

Move the issue directory from `issues/open/` to `issues/closed/` (and
optionally record a `resolution:` in the frontmatter). Commit — typically on the
same branch as the fix, so the merge that lands the fix also closes the issue.
Reopening is the inverse move.

```
$ nav issue close bqlybac0 --resolution fixed
```

### Open a pull request

On your feature branch, create `.navbook/prs/open/<id>-<slug>/pr.md` recording
the target branch and a pinned revision (the exact head and merge-base SHAs
under review). Push the branch. Anyone who fetches it sees the PR — no forge
involved.

```
$ nav pr open --target main
Created .navbook/prs/open/dk3mp2x9-auth-refactor/  (#dk3mp2x9)
```

### Review

Ask for a review by naming people in `reviewer:` on `pr.md` — that key is the
whole request, and `nav pr request` writes it.

Reviewers commit comment files to the PR's `comments/` directory on the source
branch. A review verdict is a comment whose frontmatter carries
`verdict: approve` (or `request-changes`, or `comment` for a review that judges
nothing) bound to the revision SHA it judged. Inline code comments carry
file/line anchors and quote the code they discuss. The git commit that adds an
approval is authored — and may be signed — by the approver: git itself is the
attestation chain.

Nothing records that a request has been answered, because nothing needs to:
who still owes a review is worked out from the reviews themselves, against the
latest revision. A new revision therefore asks everybody again, and no
reviewer's commit ever has to edit the file the author is working in.

```
$ nav pr request dk3m alice@example.com
$ nav pr review dk3m --approve -m "Reads well."
```

### Merge

Merge the source branch into the target as usual, moving the PR directory from
`prs/open/` to `prs/merged/` as part of the merge (or an immediate follow-up
commit). The entire discussion — description, comments, reviews, pinned
revisions — is thereby archived into the target branch's permanent history.
Declined PRs never merge; a maintainer MAY record them in `prs/closed/` on the
default branch.

### Search and list

`nav issue list status:open label:bug` gives filtered tables; `grep -r` over
`.navbook/` works too, by design.

## 1.5 What you see on a forge

Because state is files on the branch, a forge renders Navbook without knowing it
exists: the directory tree shows open vs closed at a glance; `issue.md` renders
its frontmatter table and Markdown description; comment files render as
documents; a PR's whole review history is readable in the file view of the
merged branch. This read-only rendering is Navbook's zero-install adoption path.

## 1.6 Guarantees

- **No tool lock-in.** Every state transition is a file create/edit/move
  expressible in a POSIX shell.
- **No hidden state.** Two checkouts of the same commit have identical tracker
  state. Caches, if a tool keeps any, are derived and disposable.
- **No conflict by design for the common case.** Concurrent comments touch
  distinct files. Only genuinely contradictory actions (e.g. concurrent close
  and reopen) surface as git conflicts, with resolution rules specified in
  [03-merge-and-branches.md](03-merge-and-branches.md).
- **Provenance is git.** Frontmatter timestamps and authors are display
  convenience; the authoritative record of who changed what, when, is the commit
  history (optionally signed).

## 1.7 Non-goals (v1)

- **Not a forge bridge (yet).** Bidirectional GitHub/GitLab sync is a reserved
  extension ([06-future.md](06-future.md)), not part of v1.
- **No path for non-committers, in the format itself.** Filing an issue with
  `nav` requires the ability to create a commit somewhere (a fork suffices).
  The gateway that lifts that ([06 §6.2](06-future.md)) is a deployment rather
  than a format feature: `@navbook/server` commits on a signed-in person's
  behalf, recording them in `author:` while the machine account is the
  committer. Somebody has to run it; nothing in the format assumes anybody has.
- **No web UI is required to use Navbook.** The format renders acceptably on
  forges with no plugin, and that is the property being protected. One exists
  all the same ([06 §6.3](06-future.md)) — and it reads *and* writes, which the
  earlier sketch of a read-only viewer did not anticipate. It changes nothing
  here: it composes no files of its own, and every write goes through the same
  operations `nav` runs.
- **Not an approval enforcement system.** Navbook records reviews; branch
  protection and merge policy remain the responsibility of the forge or of team
  convention. A pull request's review decision ([02 §2.7](02-data-model.md)) is
  a reading of the files, never a gate: `nav pr merge` merges a pull request
  nobody has approved, because whether that is acceptable is not the tracker's
  question to answer.
