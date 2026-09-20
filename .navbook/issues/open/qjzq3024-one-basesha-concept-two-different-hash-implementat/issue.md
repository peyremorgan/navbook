---
title: One baseSha concept, two different hash implementations
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-20T12:39:10Z
labels: [bug]
feature: [server, format]
---

The API exposes one field on four types — `Issue.baseSha`, `Pr.baseSha`, `Feature.baseSha`, `Spec.baseSha` — described in the schema in the same words ("The blob hash of `issue.md` as it now stands", "The blob hash of `feature.md` as it now stands"). They are computed two different ways.

**Entities** use core's own SHA-1 over `blob <len>\0<bytes>` (`core/src/core/hash.ts`), put on every `EntityRecord` at parse time, served by `resolvers/entity.ts` and checked by `resolvers/mutation.ts`.

**Features and documents** ask git (`git/src/index-ops.ts` → `git hash-object`), served by `resolvers/feature.ts` and checked by `ops/feature.ts`.

Each pair is internally consistent, so neither is broken today. But the two files state opposite positions on the same question. `index-ops.ts`:

> Asked of git rather than computed here, because the answer depends on the repository: which hash algorithm it uses, and which filters its attributes apply. A hash worked out in this process would be right for most repositories and quietly wrong for the rest.

`hash.ts`:

> A blob's hash is SHA-1 over `blob <byte length>\0<content>`, and that is what `git hash-object` prints for a file in a repository with no clean filters — the default, and what every clone Navbook makes for itself is.

Both are correct about their own half. Together they say the codebase holds two positions.

## Where they stop agreeing

1. **`extensions.objectFormat=sha256`.** `git hash-object` prints 64 hex; `blobSha` prints 40. Both halves keep working on their own, and a client that assumed one shape for both gets two. The schema types both as `String!`.
2. **A clean filter or `text eol=crlf` on `*.md`.** `git hash-object` applies `.gitattributes` filters and end-of-line conversion by default when given a path; `blobSha` does not.
3. **A CRLF working tree.** `blobSha` hashes what is on disk, `git hash-object` hashes what git would store. `patch.ts` already knows about this and folds line endings before comparing *fields* — "a clone with a clean filter hands git LF and keeps CRLF on disk, and the two are one body to everybody but a byte comparison" — which shows the problem is understood in one place and not the other.

`hash.ts`'s justification is "what every clone Navbook makes for itself is" — true of the server's clone, which the entrypoint creates. It is not true of a checkout the CLI runs in, which is whatever the user already had.

## Why this is low and not high

Nothing compares a core hash to a git hash. `assertFieldsUnmoved` calls `blobSha(current)` and, on a miss, resolves the client's hash with `blobContent` (`git cat-file blob`). That is the one place the two worlds touch, and it fails safe: a hash the object store does not hold reads as `null` and the write is refused as stale. In a SHA-256 repository every entity edit carrying a `baseSha` would be refused — annoying, never lossy.

## What it should do

Pick one and say so.

Asking git for both is the position `index-ops.ts` argues for and is correct in every repository; the cost is that `EntityRecord.blobSha` is computed for every entity at parse time, and `parseTree` is pure and has no git — which is the layering rule spec 05 §5.2 calls load-bearing. The honest version computes them in the workspace layer after `parseTree` returns (`hashObjects` batches, so one call per tree read), and leaves the field empty for a tree read from blobs.

Computing both in core is cheaper and keeps the layering, at the cost of being wrong under a filter or a non-default object format. If that is the choice, the feature side should move to `blobSha` and `hash.ts` should say the hash is Navbook's own token rather than git's.

Either way the schema should stop calling it "the blob hash" if it is not git's. An opaque `String!` whose only contract is "hand it back unchanged" is the honest type.
