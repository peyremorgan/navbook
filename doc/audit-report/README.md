# Audit report

A full read of the Navbook codebase as it stands on `dev` at commit `2ebc8ce`
(`feat: choose how 'nav pr merge' lands a pull request`), 2026-09-20.

Every finding below was reproduced against this checkout before it was written
down; each report says how. Nothing here is a style objection — the house style
is consistent and deliberate, and where a decision looked odd the comment above
it usually explained why.

## What was covered

| Area | Read |
|---|---|
| Specification | `doc/spec/01`–`06`, `doc/plugins.md`, the fixture contract |
| `@navbook/core` | all 45 source files: `core/`, `git/`, `workspace/`, `ops/` |
| `@navbook/cli` | all 22 source files: command tree, commands, render, install |
| `@navbook/server` | all 22 source files: config, auth, policy, sync, resolvers |
| `@navbook/web` | `nuxt.config`, plugins, composables and utils; components sampled |
| Deployment | `compose.yaml`, both Dockerfiles, both entrypoint scripts, `nginx.conf`, `.env.example` |
| CI | `.github/workflows/ci.yml`, `release.yml` |

## The state of the tree

Everything that is supposed to be green is green:

```
pnpm check                     lint + typecheck             pass
packages/core     test          743 pass   0 fail
packages/server   test          344 pass   0 fail
packages/cli      test          346 pass   0 fail
packages/web      test          373 pass   0 fail
pnpm test:conformance           117 pass   0 fail
pnpm test:deploy                 63 pass   0 fail
nav doctor (on this repository) 0 errors, 7 warnings
```

That is 1 586 tests. Every finding below is therefore something the suite does
not currently assert; three of them are one test away from being caught.

## Findings

Each is open in the tracker, with an enrichment comment carrying the
external references and the state of the art: `nav issue show <id>`.

| # | Finding | Severity | Issue |
|---|---|---|---|
| [01](01-server-issues-accepts-pr-only-filters.md) | The API's `issues` query accepts pull-request-only filter terms; `reviews: [PENDING]` matches every issue | High | `#zlr44nen` |
| [02](02-pre-commit-hook-blocks-under-set-e.md) | The pre-commit hook blocks a commit on a non-format error when appended to a hook using `set -e` | High | `#xb3jdz3q` |
| [03](03-d15-ignores-the-plugins-declaration.md) | Doctor check D15 never reads the `plugins` declaration the spec requires it to | Medium | `#gqu14qtl` |
| [04](04-documented-plugin-surface-does-not-exist.md) | `nav plugin`, `@navbook/plugin-kb` and the extension loader are documented but unimplemented | Medium | `#sle5dwk9` |
| [05](05-feature-show-commits-unvalidated.md) | `nav feature show --commits` accepts any argument and silently reports no history | Medium | `#kw143sq9` |
| [06](06-table-truncation-breaks-text.md) | Listing truncation splits surrogate pairs and miscounts wide characters | Low–Medium | `#ozzaoa36` |
| [07](07-tree-read-loads-extension-data.md) | Every command reads extension-namespace data it never interprets | Low–Medium | `#egvv9205` |
| [08](08-two-blob-hash-implementations.md) | One `baseSha` concept, two different hash implementations | Low | `#qjzq3024` |
| [09](09-list-help-omits-deadline-term.md) | `nav {issue,pr} list --help` omits the `deadline:` query term | Low | `#rz9rqg8h` |
| [10](10-spec-04-omits-merge-config.md) | Spec 04 does not document `nav install --merge-config` | Low | `#e9v8jyz3` |
| [11](11-checktimestampskew-reads-as-its-negation.md) | `checkTimestampSkew` is documented as the opposite of what it returns | Low | `#ze71ym9e` |

## What was checked and found sound

Recorded because an audit that lists only faults misrepresents the thing it
audited.

- **Token verification** (`packages/server/src/auth.ts`). `exp` is a
  `requiredClaims` entry rather than merely honoured when present — without
  that, `jose` accepts a token that carries no expiry at all. Issuer and
  audience are both checked, and every failure returns one message so a client
  cannot learn which check refused it.
- **Authorization** (`packages/server/src/policy.ts`). The rule that refused a
  verified token goes to the operator's log and never to the client, and every
  token value in that log line is JSON-quoted so a claim somebody chose cannot
  forge a second line.
- **Markdown rendering** (`packages/web/app/utils/markdown.ts`). `html: false`,
  DOMPurify over the output, `v-html` confined to one component, and
  `rel="noopener"` restored alongside the `target` DOMPurify would otherwise
  strip.
- **Open-redirect defence** (`packages/web/app/utils/navigation.ts`).
  `safeReturnPath` rejects `//host`, `/\host` and control characters, not only
  the missing leading slash, and it guards the one value in the client that
  comes back from the identity provider.
- **Optimistic concurrency** (`packages/server/src/patch.ts`). A stale write is
  refused per *field* rather than per file, so two people editing different
  fields of one issue are not in conflict — and the comparison reads each field
  the way its own resolver reads it, so a respelling is never mistaken for a
  change.
- **Merge state** (`packages/core/src/git/merge-state.ts`). A replay and a
  squash both stop without `MERGE_HEAD`, and the note that makes `--continue`
  work is all-or-nothing on read, so half a note can never send a merge to the
  wrong branch.
- **The `--commit` guard** (`packages/core/src/workspace/commit-flow.ts`).
  Both refusals — unrelated staged work, detached HEAD — run before any file is
  written, which is what the spec asks for and is easy to get backwards.
- **Publishing** (`script/require-pnpm.js`). The packages describe themselves
  twice and only pnpm applies the second description; refusing an npm pack
  outright is the right answer to a failure that would otherwise ship.
