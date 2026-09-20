# 11 — `checkTimestampSkew` is documented as the opposite of what it returns

**Tracked as:** `#ze71ym9e` — `nav issue show ze71ym9e`
**Severity:** Low — no live fault; a trap for the next caller, in a function
whose whole job is a boolean.
**Where:** [`packages/core/src/core/validate.ts:615-623`](../../packages/core/src/core/validate.ts#L615-L623)

## What is wrong

```ts
/** D10: is a frontmatter timestamp implausible next to the commit that added it? */
export function checkTimestampSkew(
  frontmatterIso: Date,
  gitAuthoredIso: Date,
  thresholdHours: number,
): boolean {
  const deltaHours = Math.abs(frontmatterIso.getTime() - gitAuthoredIso.getTime()) / 3_600_000;
  return deltaHours <= thresholdHours;
}
```

The doc comment asks "is a frontmatter timestamp **implausible**?". The function
returns `true` when the delta is **within** the threshold — that is, when the
timestamp is plausible. The name says the same thing as the comment: a
`check…Skew` that returns true reads as "there is skew".

Both call sites negate it, and are correct:

```ts
// packages/core/src/workspace/history-checks.ts:118
if (added && !checkTimestampSkew(created, added.authored, TIMESTAMP_SKEW_HOURS)) {
  out.push({ check: "D10", … });
}

// packages/core/src/workspace/history-checks.ts:131
if (checkTimestampSkew(comment.date, added.authored, TIMESTAMP_SKEW_HOURS)) continue;
```

So D10 behaves exactly as spec 04 §4.3 specifies, and the tests pass. The defect
is entirely in the contract as written.

## Why it is worth fixing

This is an exported function in `core/`, which is the layer spec 05 §5.2 says
the Rust rewrite "must reproduce function for function":

> `core/` is the layer the Rust rewrite must reproduce function-for-function.

A reimplementer working from the signature and the doc comment writes the
negation, and the resulting `nav doctor` reports D10 on every timestamp that is
*fine* and stays silent on the ones that are not. It would pass no fixture —
`doc/spec/fixtures/` has no D10 case, because D10 reads git history and the
fixtures that exercise it would have to script commit dates — so nothing would
catch it. Spec 05 §5.4's differential testing would, but only if a generated
repository happened to produce a skewed timestamp.

It is also the only predicate in `core/` whose name and comment disagree with
its body, which is worth keeping true of a codebase where the comments are this
carefully written.

## Suggested fix

Rename to what it returns, and mend the comment:

```ts
/**
 * D10: is a frontmatter timestamp plausible next to the commit that added it?
 *
 * True when the two are within `thresholdHours` of each other. The threshold
 * is the implementation's to choose — spec 04 §4.3 requires only that it be
 * documented — and `TIMESTAMP_SKEW_HOURS` is where the reference one lives.
 */
export function timestampIsPlausible(
  frontmatterIso: Date,
  gitAuthoredIso: Date,
  thresholdHours: number,
): boolean {
  const deltaHours = Math.abs(frontmatterIso.getTime() - gitAuthoredIso.getTime()) / 3_600_000;
  return deltaHours <= thresholdHours;
}
```

The two call sites then read the way they already behave:

```ts
if (added && !timestampIsPlausible(created, added.authored, TIMESTAMP_SKEW_HOURS)) { … }
if (timestampIsPlausible(comment.date, added.authored, TIMESTAMP_SKEW_HOURS)) continue;
```

Keeping the name and inverting the body is the other option, but it means
touching both call sites *and* the test, and "skew within the threshold" is a
slightly awkward thing to be true. Naming the predicate for the good state is
the smaller change and reads better at both sites.

`checkRevisionsAppendOnly` beside it is worth a glance while in the file: it
returns `{ ok: true } | { ok: false, … }`, which has no such ambiguity and is
the pattern to prefer for anything that might grow a reason.

## Test gap

`packages/core/test/validate.test.ts` covers the function's behaviour, so the
rename is mechanical. There is no fixture for D10 at all — see spec 04 §4.3,
which notes that D7, D9 and D10 read git history and are skipped under
`--staged`. A conformance case that scripts an out-of-range commit date would
close both this and the reimplementation risk above; the harness already
supports per-commit `date:` in `history:` steps, so the fixture is writable
today.
