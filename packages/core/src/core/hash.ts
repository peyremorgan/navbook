/**
 * Naming a file's contents the way git names them.
 *
 * A blob's hash is SHA-1 over `blob <byte length>\0<content>`, and that is
 * what `git hash-object` prints for a file in a repository with no clean
 * filters — the default, and what every clone Navbook makes for itself is.
 * Computed here rather than asked of git so that a record can carry the hash
 * of the exact text it was parsed from: nothing can change between the read
 * and the hash, because there is no second read.
 */

import { createHash } from "node:crypto";

/** The git blob hash of `text`, as `git hash-object` would print it. */
export function blobSha(text: string): string {
  const body = Buffer.from(text, "utf8");
  return createHash("sha1").update(`blob ${body.byteLength}\0`).update(body).digest("hex");
}
