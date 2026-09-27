/**
 * Naming a version of a file's text: what every `baseSha` is.
 *
 * SHA-1 over `blob <byte length>\0<content>` — git's shape, which makes the
 * value recognisable and lets a caller resolve it with `cat-file` when the
 * repository stores its objects the same way. It is deliberately *not* asked
 * of git: `git hash-object` applies `.gitattributes` filters and end-of-line
 * conversion, and hashes with SHA-256 in a repository that uses it, so its
 * answer depends on configuration while this one is a function of the text
 * alone. What this names is a version of some text, not an object in a store.
 *
 * Computed here also so that a record can carry the hash of the exact text it
 * was parsed from: nothing can change between the read and the hash, because
 * there is no second read.
 */

import { createHash } from "node:crypto";

/**
 * The hash of `text`: what `git hash-object --no-filters --stdin` prints in a
 * SHA-1 repository.
 */
export function blobSha(text: string): string {
  const body = Buffer.from(text, "utf8");
  return createHash("sha1").update(`blob ${body.byteLength}\0`).update(body).digest("hex");
}
