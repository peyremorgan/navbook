# Navbook Specification

**Version 0.1.0-draft — 2026-08-02**

Navbook stores a project's issues and pull requests as plaintext files inside the
repository, on the same branch and history as the code they describe. This directory
is the normative specification of the file format, its semantics, and the reference
tooling.

## Reading order

Functionality first, technical details after:

| # | Document | Contents |
|---|----------|----------|
| 1 | [01-functionality.md](01-functionality.md) | What Navbook does: concepts, user workflows, guarantees, non-goals |
| 2 | [02-data-model.md](02-data-model.md) | **Normative.** Directory layout, identifiers, file formats, frontmatter schemas |
| 3 | [03-merge-and-branches.md](03-merge-and-branches.md) | **Normative.** Branch semantics, concurrent-edit scenarios, conflict resolution |
| 4 | [04-cli.md](04-cli.md) | The `nav` CLI: commands, query syntax, hooks, completions, exit codes |
| 5 | [05-implementation.md](05-implementation.md) | Reference implementation (TypeScript), planned Rust rewrite, conformance testing |
| 6 | [06-future.md](06-future.md) | Reserved extension points: forge sync, non-committer gateways, web viewer, signatures |

The keywords MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are used as described in
RFC 2119. Documents 02 and 03 are normative; the others are informative except where
they use RFC 2119 keywords.

## Design decision log

Each decision below is expanded in the linked document.

| Decision | Choice | Why | Where |
|----------|--------|-----|-------|
| Authority model | Format-first: files + git are the system of record; the CLI is convenience and is never required | Data must outlive any tool (most prior in-tree trackers died with their tool) | 01 |
| Storage location | In the working tree, same branch/history as the code | The differentiator vs git-bug (hidden git objects) and git-issue (separate history): browsable on any forge, travels with the code | 01 |
| Issue granularity | One directory per issue; one file per comment | Concurrent comments create distinct files and can never conflict | 02 |
| Identifier | 8-char random ID + human slug as directory name (`bqlybac0-login-timeout`); the ID alone is the reference | Sequential numbers collide across branches (the historic killer); slugs keep forge browsing human | 02 |
| Root layout | `.navbook/` containing `issues/` and `prs/` | `.github/` precedent; one path for log/CI exclusions | 02 |
| Status | Encoded in the path: `issues/{open,closed}/`, `prs/{open,merged,closed}/` | State visible in the bare file tree on any forge | 02 |
| Metadata syntax | YAML frontmatter in Markdown files | De-facto standard (Jekyll/Obsidian/forge rendering); parsers everywhere | 02 |
| People | RFC 5322 email addresses, display name optional | The only decentralized identity git has; `.mailmap`-compatible | 02 |
| PR lifecycle | PR directory is born on its source branch; merging carries it into the target's history (merge-as-archive) | Opening a PR needs no coordination and works offline; no surveyed system archives discussion into mainline history automatically | 02, 03 |
| PR revisions | Append-only list of pinned `{head, base, date}` SHAs | Force-pushes become data, never mutation; "what exactly was reviewed" is always answerable | 02 |
| Reviews | Ordinary comment files with `verdict:` bound to a specific revision SHA | Unbound approvals silently cover later pushes; one content mechanism, not two | 02 |
| References | `#id` in prose; `Refs:`/`Closes:` git trailers | Greppable, one-char sigil; trailers are git-native. Mentions never change state | 02 |
| Branch of record | The repository's default branch | Feature branches stage issue changes like code changes; merging publishes them | 03 |
| v1 scope | Core format + CLI; sync/gateways reserved as future hooks | Prove the format tool-independent before building bridges | 06 |
| CLI naming | `nav` binary; configurable git alias defaulting to `git nav` | Short to type; `nav` verified unclaimed by any widely used program (checked 2026-08: no exact-name hit in Debian/Ubuntu, Homebrew, or npm bins; the only bare `nav` command belongs to the niche server-side NAV network-monitoring suite). Alias name stays configurable (e.g. `git issue`) | 04 |
| CLI structure | Noun-verb: `nav {issue\|pr} {open\|list\|show\|edit\|comment\|close\|reopen\|delete}` + PR-only `update`/`review`/`merge` + root utilities (`nav id`, `nav doctor`, setup) | One shared verb vocabulary is easier to learn and remember than per-entity command names | 04 |
| Implementation | TypeScript reference implementation now; Rust CLI rewrite when mature, cross-checked against it | Measured trade-offs (see 05); the TS core survives as the future web layer | 05 |
| v1 extras | Query syntax, git hook validation, shell completions (all environment setup unified under `nav install`); no web viewer yet | Selected scope | 04 |

## Prior art

Navbook's design is informed by (and deliberately positioned against) earlier
systems. Concepts referenced; no code or text reused — several of these projects
are copyleft-licensed while Navbook is MIT.

- [git-bug](https://github.com/git-bug/git-bug) — issues as operation logs in git objects: perfect merges, zero browsability.
- [git-issue](https://github.com/dspinellis/git-issue) — issues as per-field files, but in a separate git history.
- [Bugs Everywhere](https://bugs-everywhere.readthedocs.io/), [ditz](https://github.com/jashmenn/ditz), [Artemis](https://github.com/mrzv/artemis), [cil](https://github.com/chilts/cil), [driusan/bug](https://github.com/driusan/bug), [tissue](https://tissue.systemreboot.net/), [sit](https://github.com/sit-fyi/sit) — the in-tree tracker lineage and its lessons.
- [git-appraise](https://github.com/google/git-appraise), [Gerrit NoteDb](https://gerrit-review.googlesource.com/Documentation/note-db.html), [Radicle](https://radicle.dev/), [git-series](https://github.com/git-series/git-series), kernel patch workflow ([b4](https://b4.docs.kernel.org/)) — review-data-in-git designs.
- [Fossil's ticket rationale](https://fossil-scm.org/home/doc/trunk/www/bugtheory.wiki) — the strongest arguments *against* in-tree issues; [03](03-merge-and-branches.md) and [06](06-future.md) answer them. ("Ticket" kept here: it is Fossil's own term.)
- [Backlog.md](https://github.com/MrLesk/Backlog.md), [Beads](https://github.com/steveyegge/beads), [gh-issue-sync](https://github.com/mitsuhiko/gh-issue-sync) — the 2025-2026 wave of in-repo, agent-friendly task state.

## License

This specification, like the rest of Navbook, is MIT-licensed.
