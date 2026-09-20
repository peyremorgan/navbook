---
title: Doctor check D15 never reads the plugins declaration the spec requires it to
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-20T12:36:27Z
labels: [bug, doctor]
feature: [doctor, plugins]
---

`checkMarker` collects the faults of exactly two readings — `repo.reviewPolicy.problems` and `repo.mergePolicy.problems`. `policy.ts` defines `parseReviewPolicy` and `parseMergePolicy` and no third parser, and `Repo` carries no third reading. There is no validation of `plugins` at all.

Both halves of the specification require it. Spec 04 §4.3's doctor table names all three in one row:

> | D15 | `navbook.json` is not a JSON object, or its `review`, **`merge` or `plugins`** declaration is malformed (2.10, 2.12) | E |

And spec 02 §2.12, "Declaring them": "It MUST be a JSON object; each key names an extension and each value MUST be an object carrying whatever settings that extension reads. … A malformed declaration is a fault in the marker rather than in the tree it marks, and is reported exactly as a malformed review policy is (D15)."

## Repro

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
```

The review fault is reported. The `plugins` array — which §2.12 says MUST be an object — is not mentioned. Neither is `"plugins": { "@navbook/plugin-kb": true }` (a value that is not an object), nor `"plugins": null`. Spec 04 adds that "D15 reports one diagnostic per fault it finds, so a marker that mistypes two of its policy keys names both"; with `plugins` unread, a marker that mistypes two keys names one.

## Why it matters before the plugin tooling lands

This is a **format** check rather than a tool feature, and it is worth closing independently of #plugins work:

- The conformance fixtures are the contract a second implementation is held to (spec 05 §5.4). A Rust `nav doctor` that reports a malformed `plugins` declaration and a TypeScript one that does not are not the same tool, and nothing in the suite would catch the difference.
- D15 is decidable from the tree alone, so it runs under `--staged` and the pre-commit hook is meant to catch a marker somebody mistyped before it lands. It does not.
- §2.12's whole purpose is that "a clone can tell what its own tree contains, and say so when something is missing". A declaration nothing validates is a declaration nothing can rely on.

## What it should do

A third reading beside the other two, mirroring `parseMergePolicy` exactly: not JSON → `is not valid JSON`; not an object → `is not a JSON object`; `plugins` not an object → `'plugins' must be an object`; a value that is not an object → `'plugins.<name>' must be an object`. Fall back to declaring nothing rather than propagating the fault, as the other two do, so a mistyped marker never stops a listing. The message collapsing already in `checkMarker` handles the shared "is not valid JSON" fault for free.

One detail from §2.12: the *key* is the extension's own name for itself — an npm package name in the reference implementation — and §2.12 does not constrain its grammar ("a second implementation naming its extensions some other way is conforming so long as the names agree"). So the key must not be validated against the `^[a-z][a-z0-9]*$` short-name grammar.
