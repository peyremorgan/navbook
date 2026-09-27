# 08 — One `baseSha` concept, two different hash implementations

**Tracked as:** `#qjzq3024` — `nav issue show qjzq3024`
**Severity:** Low — each half is self-consistent today; the risk is that they
are documented as one thing and will diverge under a repository that is not the
default.
**Where:** [`packages/core/src/core/hash.ts`](../../packages/core/src/core/hash.ts),
[`packages/core/src/git/index-ops.ts:44-71`](../../packages/core/src/git/index-ops.ts#L44-L71)

## What is wrong

The API exposes one field on four types — `Issue.baseSha`, `Pr.baseSha`,
`Feature.baseSha`, `Spec.baseSha` — described in the schema in the same words:

> The blob hash of `issue.md` as it now stands. Hand it back as `baseSha` when
> editing a field from a rendered value …

> The blob hash of `feature.md` as it now stands. Hand it back as `baseSha` when
> editing …

They are computed two different ways.

**Entities** use core's own implementation, SHA-1 over `blob <len>\0<bytes>`:

```ts
// packages/core/src/core/hash.ts:15-18
export function blobSha(text: string): string {
  const body = Buffer.from(text, "utf8");
  return createHash("sha1").update(`blob ${body.byteLength}\0`).update(body).digest("hex");
}
```

`tree.ts:520` puts it on every `EntityRecord`; `resolvers/entity.ts:88` serves
it; `resolvers/mutation.ts:600` checks it with the same function.

**Features and documents** ask git:

```ts
// packages/core/src/git/index-ops.ts:57-66
export function hashObjects(cwd: string, paths: readonly string[]): Map<string, string> {
  const result = gitRun(["hash-object", "--", ...paths], { cwd });
  …
}
```

`resolvers/feature.ts:40` serves it; `ops/feature.ts:290` checks it with
`hashObject`.

Each pair is internally consistent, so neither is broken. But `index-ops.ts`
states plainly why it chose git — and the reason applies to the other pair too:

> Asked of git rather than computed here, because the answer depends on the
> repository: which hash algorithm it uses, and which filters its attributes
> apply. A hash worked out in this process would be right for most repositories
> and quietly wrong for the rest.

`hash.ts` answers the same question the other way:

> A blob's hash is SHA-1 over `blob <byte length>\0<content>`, and that is what
> `git hash-object` prints for a file in a repository with no clean filters —
> the default, and what every clone Navbook makes for itself is.

Both comments are correct about their own half. Together they say the codebase
holds two positions on one question.

## Where it actually bites

Three cases where the two stop agreeing:

1. **`extensions.objectformat=sha256`.** `git hash-object` prints a 64-hex
   SHA-256; `blobSha` prints a 40-hex SHA-1. Feature edits keep working
   (self-consistent); entity edits keep working (self-consistent); a client that
   assumed one shape for both gets two. The schema types both as `String!`, so
   nothing catches it.
2. **A clean filter on `*.md`** (`.gitattributes` with `filter=` or
   `text eol=crlf`). `git hash-object` applies it and `blobSha` does not, so the
   two halves disagree about the same file's hash. Still self-consistent within
   each half.
3. **A CRLF working tree.** `blobSha` hashes what is on disk; `git hash-object`
   hashes what git would store. `patch.ts:150` already knows about this and
   folds line endings before comparing *fields* — "a clone with a clean filter
   hands git LF and keeps CRLF on disk, and the two are one body to everybody
   but a byte comparison" — which shows the problem is understood in one place
   and not the other.

The comment on `hash.ts` says the SHA-1 reading is right for "what every clone
Navbook makes for itself is" — true of the server's own clone, which the
entrypoint creates. It is not true of a checkout the *CLI* runs in, which is
whatever the user already had.

## Why it is only Low

Nothing compares a core hash to a git hash. `assertFieldsUnmoved`
(`mutation.ts:596-624`) calls `blobSha(current)` and, on a miss, resolves the
client's hash with `blobContent` — `git cat-file blob <sha>`. That is the one
place the two worlds touch, and it is *safe by the shape of the failure*: a
SHA-1 the object store does not hold reads as `null` and the write is refused as
stale, which is the conservative answer. In a SHA-256 repository every entity
edit that sends a `baseSha` would be refused — annoying, never lossy.

## Suggested fix

Pick one and say so.

**Asking git for both** is the position `index-ops.ts` argues for, and it is
correct in every repository. The cost is a subprocess where there is currently
none: `EntityRecord.blobSha` is computed for every entity in the tree at parse
time, and a listing of a thousand issues cannot afford a thousand
`git hash-object` calls. `hashObjects` batches, so one call per tree read is
achievable — but `parseTree` is pure and has no git, which is the layering rule
spec 05 §5.2 calls load-bearing. The honest version is to compute the hashes in
the *workspace* layer after `parseTree` returns, and leave the field empty for a
tree read from blobs.

**Computing both in core** is cheaper and keeps the layering, at the cost of
being wrong under a filter or a non-default object format. If that is the
choice, `ops/feature.ts` and `resolvers/feature.ts` should move to `blobSha`,
and `hash.ts`'s comment should say that the hash is Navbook's own token rather
than git's — which it effectively is, since nothing ever looks it up in the
object store except as a fallback.

Whichever way it goes, the schema should stop describing it as "the blob hash"
if it is not git's, and should say the two are computed the same way if they
are. An opaque `String!` whose only contract is "hand it back unchanged" is the
honest type for it.

## Test gap

Neither half is tested against a repository with a `.gitattributes` filter or a
non-default `objectformat`. A single test that sets `core.autocrlf` or a clean
filter and then round-trips an entity edit and a feature edit would show the
divergence immediately.
