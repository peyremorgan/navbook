---
title: checkTimestampSkew is documented and named as the opposite of what it returns
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-20T12:40:33Z
labels: [enhancement, doctor]
feature: [doctor, conformance]
---

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

The doc comment asks "is a frontmatter timestamp **implausible**?". The function returns `true` when the delta is **within** the threshold — when the timestamp is plausible. The name says the same as the comment: a `check…Skew` that returns true reads as "there is skew".

Both call sites negate it and are correct, so D10 behaves exactly as spec 04 §4.3 specifies and the tests pass:

```ts
if (added && !checkTimestampSkew(created, added.authored, TIMESTAMP_SKEW_HOURS)) { … }
if (checkTimestampSkew(comment.date, added.authored, TIMESTAMP_SKEW_HOURS)) continue;
```

The defect is entirely in the contract as written.

## Why it is worth fixing anyway

This is an exported function in `core/`, which spec 05 §5.2 says the Rust rewrite "must reproduce function-for-function". A reimplementer working from the signature and the doc comment writes the negation, and the resulting `nav doctor` reports D10 on every timestamp that is fine and stays silent on the ones that are not. Nothing would catch it: `doc/spec/fixtures/` has no D10 case, and spec 05 §5.4's differential testing would only find it if a generated repository happened to produce a skewed timestamp.

It is also the only predicate in `core/` whose name and comment disagree with its body, which is worth keeping true of a codebase where the comments are this carefully written.

## What it should do

Rename to what it returns:

```ts
/**
 * D10: is a frontmatter timestamp plausible next to the commit that added it?
 *
 * True when the two are within `thresholdHours` of each other. The threshold is
 * the implementation's to choose — spec 04 §4.3 requires only that it be
 * documented — and `TIMESTAMP_SKEW_HOURS` is where the reference one lives.
 */
export function timestampIsPlausible(…): boolean
```

The call sites then read the way they already behave. Keeping the name and inverting the body is the other option, but it means touching both call sites *and* the test, and "skew within the threshold" is an awkward thing to be true.
