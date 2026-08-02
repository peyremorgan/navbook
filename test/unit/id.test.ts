import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { describe, it } from "node:test";
import { ID_ALPHABET, isId, mintId, resolvePrefix } from "../../src/core/id.ts";

const realRandom = (n: number): Uint8Array => webcrypto.getRandomValues(new Uint8Array(n));

describe("isId", () => {
  it("accepts the spec's examples", () => {
    for (const id of ["bqlybac0", "mz4kq1rv", "dk3mp2x9", "t5kr1gq6", "q8zm3vp1"]) {
      assert.equal(isId(id), true, id);
    }
  });

  it("rejects ids that break the grammar", () => {
    const bad = [
      "", // empty
      "bqlybac", // too short
      "bqlybac01", // too long
      "0qlybac1", // leading digit
      "feedback", // no digit: an English word
      "BQLYBAC0", // uppercase
      "bqly-ac0", // punctuation
      "bqly bac0", // space
      "bqlybacö", // non-ascii
    ];
    for (const id of bad) assert.equal(isId(id), false, JSON.stringify(id));
  });

  it("requires at least one digit even when everything else is legal", () => {
    assert.equal(isId("abcdefgh"), false);
    assert.equal(isId("abcdefg1"), true);
  });
});

describe("mintId", () => {
  it("always produces ids that satisfy the grammar", () => {
    for (let i = 0; i < 2000; i++) assert.equal(isId(mintId(realRandom)), true);
  });

  it("uses the whole alphabet and does not repeat itself", () => {
    const seen = new Set<string>();
    const chars = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      const id = mintId(realRandom);
      seen.add(id);
      for (const char of id) chars.add(char);
    }
    assert.equal(seen.size, 5000, "5000 draws should not collide with 41 bits of entropy");
    assert.equal(chars.size, ID_ALPHABET.length, "every alphabet character should appear");
  });

  it("refills its pool when a draw is exhausted by rejected bytes", () => {
    // Bytes >= 252 are always discarded, so the first two pools yield nothing.
    let call = 0;
    const usable = [0, 27, 1, 2, 3, 4, 5, 6];
    let index = 0;
    const slowStart = (n: number): Uint8Array => {
      call++;
      if (call <= 2) return new Uint8Array(n).fill(255);
      return Uint8Array.from({ length: n }, () => usable[index++ % usable.length] as number);
    };
    assert.equal(mintId(slowStart), "a1bcdefg");
  });

  it("gives up loudly on a source that can never satisfy the grammar", () => {
    // All-'b' candidates have no digit, so no candidate can ever be valid.
    const degenerate = (n: number): Uint8Array => new Uint8Array(n).fill(1);
    assert.throws(() => mintId(degenerate), /random source/);
  });

  it("never returns a value drawn from out-of-range bytes", () => {
    // 252..255 must be discarded, not folded, or 'a'..'d' would be over-represented.
    const bytes = [255, 254, 253, 252, 0, 27, 1, 2, 3, 4, 5, 6];
    let index = 0;
    const scripted = (n: number): Uint8Array =>
      Uint8Array.from({ length: n }, () => bytes[index++ % bytes.length] as number);
    // 255, 254, 253 and 252 are all discarded, so the id starts at byte 0 ('a')
    // and continues 27 ('1'), 1 ('b'), 2 ('c') ... rather than folding them in.
    assert.equal(mintId(scripted), "a1bcdefg");
  });
});

describe("resolvePrefix", () => {
  const ids = ["bqlybac0", "bqlyxxx1", "mz4kq1rv"];

  it("accepts an exact id even when shorter rules would reject it", () => {
    assert.deepEqual(resolvePrefix("bqlybac0", ids), { ok: true, id: "bqlybac0" });
  });

  it("accepts an unambiguous prefix of at least four characters", () => {
    assert.deepEqual(resolvePrefix("mz4k", ids), { ok: true, id: "mz4kq1rv" });
  });

  it("rejects prefixes shorter than four characters", () => {
    assert.deepEqual(resolvePrefix("mz4", ids), { ok: false, reason: "too-short", matches: [] });
  });

  it("reports every candidate when a prefix is ambiguous", () => {
    const result = resolvePrefix("bqly", ids);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "ambiguous");
    assert.deepEqual(result.ok === false ? result.matches : [], ["bqlybac0", "bqlyxxx1"]);
  });

  it("reports not-found for a prefix nothing starts with", () => {
    assert.deepEqual(resolvePrefix("zzzz", ids), { ok: false, reason: "not-found", matches: [] });
  });

  it("is case-insensitive about what the user typed", () => {
    assert.deepEqual(resolvePrefix("MZ4K", ids), { ok: true, id: "mz4kq1rv" });
  });
});
