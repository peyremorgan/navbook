import { describe, expect, it } from "vitest";
import { createUnsavedWork } from "~/utils/unsaved";

describe("createUnsavedWork", () => {
  it("is clean with nothing held, and dirty while any held draft is", () => {
    const work = createUnsavedWork();
    expect(work.dirty()).toBe(false);

    let typed = false;
    work.hold(() => false);
    work.hold(() => typed);
    expect(work.dirty()).toBe(false);
    typed = true;
    expect(work.dirty()).toBe(true);
  });

  it("forgets a draft once its owner lets go", () => {
    const work = createUnsavedWork();
    const release = work.hold(() => true);
    expect(work.dirty()).toBe(true);
    release();
    expect(work.dirty()).toBe(false);
  });

  it("keeps a second hold of the same predicate when the first is released", () => {
    const work = createUnsavedWork();
    const isDirty = () => true;
    const first = work.hold(isDirty);
    work.hold(isDirty);
    first();
    expect(work.dirty()).toBe(true);
  });

  it("asks, and resolves with the answer given", async () => {
    const work = createUnsavedWork();
    const leaving = work.confirmLeave();
    expect(work.asking.value).toBe(true);
    work.answer(true);
    await expect(leaving).resolves.toBe(true);
    expect(work.asking.value).toBe(false);

    const staying = work.confirmLeave();
    work.answer(false);
    await expect(staying).resolves.toBe(false);
  });

  it("answers an older question with stay when a newer one replaces it", async () => {
    const work = createUnsavedWork();
    const older = work.confirmLeave();
    const newer = work.confirmLeave();
    await expect(older).resolves.toBe(false);
    expect(work.asking.value).toBe(true);
    work.answer(true);
    await expect(newer).resolves.toBe(true);
  });

  it("holds nothing once discarded, and holds again what comes after", () => {
    const work = createUnsavedWork();
    work.hold(() => true);
    work.discard();
    expect(work.dirty()).toBe(false);
    work.hold(() => true);
    expect(work.dirty()).toBe(true);
  });

  it("ignores an answer when nothing is being asked", () => {
    const work = createUnsavedWork();
    expect(() => work.answer(true)).not.toThrow();
    expect(work.asking.value).toBe(false);
  });
});
