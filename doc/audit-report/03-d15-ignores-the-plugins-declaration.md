# 03 — Doctor check D15 never reads the `plugins` declaration

**Tracked as:** `#gqu14qtl` — `nav issue show gqu14qtl`
**Severity:** Medium — a normative check is specified and not implemented, so a
malformed marker passes `nav doctor` in silence.
**Where:** [`packages/core/src/core/validate.ts:715-724`](../../packages/core/src/core/validate.ts#L715-L724),
[`packages/core/src/core/policy.ts`](../../packages/core/src/core/policy.ts)

## What is wrong

`checkMarker` collects the faults of exactly two readings:

```ts
// packages/core/src/core/validate.ts:715-724
function checkMarker(repo: Repo): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  for (const problem of [...repo.reviewPolicy.problems, ...repo.mergePolicy.problems]) {
    ...
  }
  return out;
}
```

`Repo` carries `reviewPolicy` and `mergePolicy` and nothing else read out of the
marker (`tree.ts:164-167`), and `policy.ts` defines `parseReviewPolicy` and
`parseMergePolicy` and no third parser. There is no reading of `plugins` at all.

## Why it is wrong

Both halves of the specification on this branch require it.

**Spec 04 §4.3, the doctor table**, names all three in one row:

> | D15 | `navbook.json` is not a JSON object, or its `review`, **`merge` or
> `plugins`** declaration is malformed ([2.10], [2.12]) | E |

**Spec 02 §2.12, "Declaring them"**, is equally explicit:

> `plugins`, in the marker (§2.10), is where a repository says which extensions
> its tree uses. It MUST be a JSON object; each key names an extension and each
> value MUST be an object carrying whatever settings that extension reads.
>
> A malformed declaration is a fault in the marker rather than in the tree it
> marks, and is reported exactly as a malformed review policy is (D15, [04
> §4.3]): the entities remain readable, every reader falls back to declaring
> nothing, and the fault is reported rather than acted on.

And **spec 02 §2.10** lists it as one of the four keys this revision defines:

> This revision defines four keys, `version`, … `review`, … `merge`, … and
> `plugins`, the declaration of §2.12.

## Reproduction

A marker with a `plugins` key of the wrong type, beside a `review` key of the
wrong type, so the contrast is in one run:

```console
$ cat .navbook/navbook.json
{
  "version": 1,
  "plugins": ["@navbook/plugin-kb"],
  "review": { "minApprovals": "two" }
}

$ nav doctor
error  D15  .navbook/navbook.json: 'review.minApprovals' must be a whole number of at least 1
1 error, 0 warnings
$ echo $?
2
```

The review fault is reported. The `plugins` array — which §2.12 says MUST be an
object — is not mentioned. Neither is `"plugins": { "@navbook/plugin-kb": true }`
(a value that is not an object), nor `"plugins": null`.

Spec 04 adds that "D15 reports one diagnostic per fault it finds, so a marker
that mistypes two of its policy keys names both". With `plugins` unread, a
marker that mistypes two keys names one.

## Why it matters even before plugins are implemented

Finding [04](04-documented-plugin-surface-does-not-exist.md) covers the missing
`nav plugin` command. This one is separate and is the more important half,
because D15 is a **format** check rather than a tool feature:

- The conformance fixtures are the contract a second implementation is held to
  (spec 05 §5.4). A Rust `nav doctor` that reports a malformed `plugins`
  declaration and a TypeScript one that does not are not the same tool, and the
  fixture suite would not catch the difference.
- D15 "is decidable from the tree alone, so unlike D7, D9 and D10 it runs under
  `--staged` and the pre-commit hook blocks a link broken by hand" (spec 04).
  A marker somebody mistypes is meant to be caught at commit time, and is not.
- The declaration is the one thing that lets "a clone tell what its own tree
  contains, and say so when something is missing" (§2.12). A declaration nothing
  validates is a declaration nothing can rely on.

## Suggested fix

The shape is already established twice over. A third parser beside the other two
in `policy.ts`:

```ts
/** What a repository says its tree contains — spec 02 §2.12. */
export interface PluginsReading {
  /** Each declared extension and the settings it carries. */
  declared: Record<string, Record<string, unknown>>;
  problems: string[];
}

export function parsePluginDeclaration(markerText: string | undefined): PluginsReading {
  // …mirror parseMergePolicy: not JSON → ["is not valid JSON"];
  // not an object → ["is not a JSON object"]; `plugins` not an object →
  // ["'plugins' must be an object"]; a value that is not an object →
  // ["'plugins.<name>' must be an object"]; fall back to declaring nothing.
}
```

then a third field on `Repo` (`tree.ts`), and a third source in `checkMarker`.
The message collapsing that is already there handles the shared "is not valid
JSON" fault for free — which is exactly why it is there.

Two details worth getting right, both from §2.12:

- **An extension short name matches `^[a-z][a-z0-9]*$`**, but the *key* of the
  `plugins` object is the extension's own name for itself — an npm package name
  in the reference implementation. §2.12 does not constrain the key's grammar,
  and "a second implementation naming its extensions some other way is
  conforming so long as the names agree". So the key should not be validated
  against the short-name grammar.
- **Falling back means declaring nothing**, not propagating the fault — the same
  rule the other two follow, so a mistyped marker never stops a listing.

## Test gap

`doc/spec/fixtures/format/invalid/d15-review-policy/` and
`d15-merge-policy/` exist. A `d15-plugins/` fixture beside them is the natural
place for this, and it is what would hold a second implementation to the same
answer.
