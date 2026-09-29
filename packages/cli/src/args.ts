/**
 * Numeric option values, refused where they are read.
 *
 * Commander catches an `InvalidArgumentError` thrown by a parser and reports
 * it as a usage error, so a bad value never reaches a command. That keeps a
 * flag's validation beside its declaration rather than in whichever command
 * happens to read it — which is how `nav feature show --commits 2.5` came to
 * report an empty history instead of a mistake (#kw143sq9).
 *
 * Both read plain decimal notation only. `Number` alone would also take
 * `0x10`, `0b11` and `1e3`, none of which anybody means by a count of levels
 * or a place in a queue, and `Number("")` is 0.
 *
 * Commander prints the message after its own "option '--x <n>' argument 'v'
 * is invalid.", so each one is a sentence of its own and names the unit.
 */

import { InvalidArgumentError } from "commander";

const DIGITS = /^\s*\d+\s*$/;
const DECIMAL = /^\s*[-+]?(\d+(\.\d*)?|\.\d+)\s*$/;

/**
 * A count: a whole number no smaller than `min`.
 *
 * `unit` is null for a plugin's option, whose manifest says it is a count but
 * not of what.
 */
export function wholeNumber(unit: string | null, min = 0): (value: string) => number {
  return (value) => {
    const parsed = Number(value);
    if (!DIGITS.test(value) || !Number.isSafeInteger(parsed) || parsed < min) {
      const floor = min > 0 ? `, at least ${min}` : "";
      const of = unit === null ? "" : ` of ${unit}`;
      throw new InvalidArgumentError(`Expected a whole number${of}${floor}.`);
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
  if (!DECIMAL.test(value) || !Number.isFinite(parsed)) {
    throw new InvalidArgumentError("Expected a number.");
  }
  return parsed;
}
