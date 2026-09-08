/**
 * Timestamps are instants and a `deadline` is a day, and the difference is the
 * whole reason the second set of helpers exists (spec 02 §2.4, §2.5).
 *
 * What is worth pinning about a calendar date is that both halves of the
 * question are asked: the shape, and whether the day it names exists. A
 * regular expression alone accepts the thirtieth of February, and a parse
 * alone accepts a timestamp.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calendarDateOf, isCalendarDate, parseIso, toIsoSeconds } from "../src/core/time.ts";

describe("isCalendarDate", () => {
  it("accepts a day written YYYY-MM-DD", () => {
    for (const value of ["2026-10-01", "2026-01-01", "2026-12-31", "0001-01-01", "9999-12-31"]) {
      assert.equal(isCalendarDate(value), true, value);
    }
  });

  it("knows which Februaries have a twenty-ninth", () => {
    assert.equal(isCalendarDate("2024-02-29"), true);
    assert.equal(isCalendarDate("2000-02-29"), true, "a century divisible by 400 is a leap year");
    assert.equal(isCalendarDate("2023-02-29"), false);
    assert.equal(isCalendarDate("1900-02-29"), false, "a century otherwise is not");
  });

  it("refuses a day that does not exist, however well it is spelled", () => {
    for (const value of ["2026-02-30", "2026-13-01", "2026-00-10", "2026-10-00", "2026-10-32"]) {
      assert.equal(isCalendarDate(value), false, value);
    }
  });

  it("refuses anything carrying a time or a zone", () => {
    for (const value of ["2026-10-01T00:00:00Z", "2026-10-01 09:00", "2026-10-01T09:00+02:00"]) {
      assert.equal(isCalendarDate(value), false, value);
    }
  });

  it("refuses a shape that is nearly right", () => {
    for (const value of ["", "2026-1-1", "26-10-01", "2026/10/01", "20261001", "someday"]) {
      assert.equal(isCalendarDate(value), false, value);
    }
  });

  it("does not trim, unlike the timestamp parser", () => {
    // A timestamp arrives from a clock and may be spelled loosely; a deadline
    // is one field somebody typed, and a stray space in a file is worth saying.
    assert.notEqual(parseIso(" 2026-10-01"), null);
    assert.equal(isCalendarDate(" 2026-10-01"), false);
    assert.equal(isCalendarDate("2026-10-01 "), false);
  });

  it("agrees with the timestamp parser about which dates are real", () => {
    // Every calendar date is an instant this codebase can also read; the
    // reverse does not hold, which is exactly why the two are separate.
    for (const value of ["2026-10-01", "2024-02-29"]) {
      assert.notEqual(parseIso(value), null, value);
    }
  });
});

describe("calendarDateOf", () => {
  it("names the UTC day an instant falls on", () => {
    assert.equal(calendarDateOf(new Date("2026-09-08T00:00:00Z")), "2026-09-08");
    assert.equal(calendarDateOf(new Date("2026-09-08T23:59:59Z")), "2026-09-08");
    assert.equal(calendarDateOf(new Date("2026-09-09T00:00:00Z")), "2026-09-09");
  });

  it("reads UTC whatever zone the machine is in", () => {
    // A day that differs between UTC and the western hemisphere: the answer
    // must not, or `overdue` would mean two things at once.
    assert.equal(calendarDateOf(new Date("2026-09-08T02:00:00Z")), "2026-09-08");
  });

  it("hands back a day the date checker accepts", () => {
    assert.equal(isCalendarDate(calendarDateOf(new Date("2026-02-29T12:00:00Z"))), true);
    assert.equal(calendarDateOf(new Date("2026-03-01T12:00:00Z")), "2026-03-01");
  });

  it("is the first ten characters of the timestamp for the same instant", () => {
    const now = new Date("2026-09-08T11:22:33Z");
    assert.equal(calendarDateOf(now), toIsoSeconds(now).slice(0, 10));
  });
});
