/**
 * Numeric option values, refused where they are read.
 *
 * Commander catches an `InvalidArgumentError` thrown by a parser and reports
 * it as a usage error, so a bad value never reaches a command. That keeps a
 * flag's validation beside its declaration rather than in whichever command
 * happens to read it — which is how `nav feature show --commits 2.5` came to
 * report an empty history instead of a mistake (#kw143sq9).
 *
 * Commander prints the message after its own "option '--x <n>' argument 'v'
 * is invalid.", so each one is a sentence of its own and names the unit.
 */

import { InvalidArgumentError } from "commander";

/**
 * A count: a whole number no smaller than `min`. Blank is refused rather than
 * read as `Number("")`, which is 0 — a count nobody asked for.
 */
export function wholeNumber(unit: string, min = 0): (value: string) => number {
  return (value) => {
    const parsed = Number(value);
    if (value.trim() === "" || !Number.isInteger(parsed) || parsed < min) {
      const floor = min > 0 ? `, at least ${min}` : "";
      throw new InvalidArgumentError(`Expected a whole number of ${unit}${floor}.`);
    }
    return parsed;
  };
}

/**
 * A position rather than a count: any finite decimal, negatives and zero
 * included (spec 02 §2.5), so it must not be folded into `wholeNumber`.
 */
export function finiteNumber(value: string): number {
  const parsed = Number(value);
  if (value.trim() === "" || !Number.isFinite(parsed)) {
    throw new InvalidArgumentError("Expected a number.");
  }
  return parsed;
}
