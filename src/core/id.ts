/**
 * Navbook identifiers — spec 02 §2.2.
 *
 * Grammar: exactly 8 characters, `^[a-z][a-z0-9]{7}$`, containing at least one
 * digit. The leading letter keeps YAML from parsing an ID as a number; the
 * mandatory digit keeps English words from being mistaken for IDs.
 */

/** Source of randomness, injected so that `core` stays pure and browser-safe. */
export type RandomBytes = (n: number) => Uint8Array;

export const ID_LENGTH = 8;
export const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export const ID_PATTERN = /^[a-z][a-z0-9]{7}$/;

/** Minimum length of an ID prefix accepted wherever a CLI takes an ID (§2.2). */
export const MIN_PREFIX_LENGTH = 4;

/** True if `s` is a syntactically valid Navbook ID. */
export function isId(s: string): boolean {
  return ID_PATTERN.test(s) && /[0-9]/.test(s);
}

/**
 * Mint a fresh ID by rejection sampling: draw 8 uniform characters from the
 * 36-character alphabet, discarding candidates that violate the grammar.
 *
 * Bytes ≥ 252 are discarded before the modulo so the character distribution is
 * exactly uniform (252 = 7 × 36).
 */
export function mintId(randomBytes: RandomBytes): string {
  const limit = 252;
  for (let attempt = 0; attempt < 1000; attempt++) {
    const chars: string[] = [];
    // Draw generously so a single call usually suffices even with rejections.
    let pool = randomBytes(ID_LENGTH * 2);
    let i = 0;
    while (chars.length < ID_LENGTH) {
      if (i >= pool.length) {
        pool = randomBytes(ID_LENGTH * 2);
        i = 0;
      }
      const byte = pool[i++] as number;
      if (byte >= limit) continue;
      chars.push(ID_ALPHABET[byte % ID_ALPHABET.length] as string);
    }
    const candidate = chars.join("");
    if (isId(candidate)) return candidate;
  }
  /* c8 ignore next */
  throw new Error("failed to mint an ID: random source is not producing usable bytes");
}

export type PrefixResolution =
  | { ok: true; id: string }
  | { ok: false; reason: "too-short"; matches: [] }
  | { ok: false; reason: "not-found"; matches: [] }
  | { ok: false; reason: "ambiguous"; matches: string[] };

/**
 * Resolve an ID prefix against known IDs. Exact matches win outright; otherwise
 * the prefix must be at least {@link MIN_PREFIX_LENGTH} characters and match
 * exactly one candidate.
 */
export function resolvePrefix(prefix: string, candidates: readonly string[]): PrefixResolution {
  const needle = prefix.toLowerCase();
  if (candidates.includes(needle)) return { ok: true, id: needle };
  if (needle.length < MIN_PREFIX_LENGTH) return { ok: false, reason: "too-short", matches: [] };
  const matches = candidates.filter((c) => c.startsWith(needle)).sort();
  if (matches.length === 1) return { ok: true, id: matches[0] as string };
  if (matches.length === 0) return { ok: false, reason: "not-found", matches: [] };
  return { ok: false, reason: "ambiguous", matches };
}
