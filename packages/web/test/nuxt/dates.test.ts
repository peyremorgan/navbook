/**
 * A deadline is a day and not an instant (spec 02 §2.5), so none of this goes
 * near `parseTimestamp`: reading a day as an instant puts it in the reader's
 * zone and shifts it for half the world.
 *
 * What is worth pinning is the arithmetic at the boundaries — the day itself,
 * the day either side of it, and a difference measured across a daylight-saving
 * change — because those are where a naive subtraction is wrong by one.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  absoluteDate,
  daysUntil,
  dueLabel,
  isCalendarDate,
  localToday,
} from "../../app/utils/dates";

describe("isCalendarDate", () => {
  it("accepts a day written YYYY-MM-DD", () => {
    for (const value of ["2026-10-01", "2026-12-31", "2024-02-29"]) {
      assert.equal(isCalendarDate(value), true, value);
    }
  });

  it("refuses a day that does not exist, a time, or a near miss", () => {
    for (const value of [
      "2026-02-30",
      "2023-02-29",
      "2026-13-01",
      "2026-10-01T09:00:00Z",
      "2026-1-1",
      "20261001",
      " 2026-10-01",
      "",
      "someday",
    ]) {
      assert.equal(isCalendarDate(value), false, value);
    }
  });

  it("agrees with the rule core applies to the same value", () => {
    // The two implementations cannot import one another, so what keeps them in
    // step is the specification and a matching case on each side.
    assert.equal(isCalendarDate("2000-02-29"), true);
    assert.equal(isCalendarDate("1900-02-29"), false);
  });
});

describe("localToday", () => {
  it("reads the day off the reader's own calendar, not off UTC", () => {
    // Built from the local getters, so a machine east or west of Greenwich
    // still calls its own midnight the start of its own day.
    const now = new Date(2026, 8, 8, 23, 30);
    assert.equal(localToday(now), "2026-09-08");
  });

  it("pads a single-digit month and day", () => {
    assert.equal(localToday(new Date(2026, 0, 5, 12)), "2026-01-05");
  });

  it("hands back something the date checker accepts", () => {
    assert.equal(isCalendarDate(localToday()), true);
  });
});

describe("daysUntil", () => {
  it("counts forward, backward and to nothing at all", () => {
    assert.equal(daysUntil("2026-09-11", "2026-09-08"), 3);
    assert.equal(daysUntil("2026-09-08", "2026-09-08"), 0);
    assert.equal(daysUntil("2026-09-06", "2026-09-08"), -2);
  });

  it("counts across a month, a year and a leap day", () => {
    assert.equal(daysUntil("2026-10-01", "2026-09-30"), 1);
    assert.equal(daysUntil("2027-01-01", "2026-12-31"), 1);
    assert.equal(daysUntil("2024-03-01", "2024-02-28"), 2, "2024 has a 29th");
    assert.equal(daysUntil("2023-03-01", "2023-02-28"), 1, "2023 does not");
  });

  it("counts whole days across a daylight-saving change", () => {
    // Both ends are read at noon UTC, so the twenty-three and twenty-five hour
    // days a local reading would produce cannot round the division either way.
    assert.equal(daysUntil("2026-03-30", "2026-03-28"), 2);
    assert.equal(daysUntil("2026-10-26", "2026-10-24"), 2);
  });

  it("is null when either end is not a day", () => {
    assert.equal(daysUntil("someday", "2026-09-08"), null);
    assert.equal(daysUntil("2026-09-08", "nonsense"), null);
  });
});

describe("dueLabel", () => {
  const TODAY = "2026-09-08";
  const on = (deadline: string) => dueLabel(deadline, TODAY);

  it("names today and tomorrow rather than counting them", () => {
    assert.deepEqual(on(TODAY), { text: "due today", overdue: false });
    assert.deepEqual(on("2026-09-09"), { text: "due tomorrow", overdue: false });
  });

  it("counts the days ahead", () => {
    assert.equal(on("2026-09-11").text, "due in 3 days");
    assert.equal(on("2026-09-11").overdue, false);
  });

  it("counts the days behind, and says so", () => {
    assert.deepEqual(on("2026-09-07"), { text: "1 day overdue", overdue: true });
    assert.deepEqual(on("2026-09-06"), { text: "2 days overdue", overdue: true });
  });

  it("does not call today overdue, which is the strictness the filter has", () => {
    // The server judges `OVERDUE` the same way (spec 04 §4.3): work wanted
    // today is wanted, not late.
    assert.equal(on(TODAY).overdue, false);
    assert.equal(on("2026-09-07").overdue, true);
  });

  it("shows the date itself once the count stops being useful", () => {
    const far = on("2027-09-08");
    assert.match(far.text, /^due /);
    assert.doesNotMatch(far.text, /days/);
    assert.equal(far.overdue, false);
    // A month out is still counted.
    assert.equal(on("2026-10-08").text, "due in 30 days");
  });

  it("hands back the value unchanged when it is not a day", () => {
    assert.deepEqual(dueLabel("someday", TODAY), { text: "someday", overdue: false });
  });

  it("reads against the reader's own day when it is not told one", () => {
    assert.equal(dueLabel(localToday()).text, "due today");
  });
});

describe("absoluteDate", () => {
  it("spells the day out without shifting it into another one", () => {
    // Built from the parts rather than from a parsed instant, so a date is
    // never printed as the day before it in a zone behind UTC.
    const text = absoluteDate("2026-10-01");
    assert.match(text, /2026/);
    assert.match(text, /1/);
    assert.doesNotMatch(text, /September 30/);
  });

  it("hands back the value unchanged when it is not a day", () => {
    assert.equal(absoluteDate("someday"), "someday");
  });
});
