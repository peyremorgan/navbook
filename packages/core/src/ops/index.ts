/**
 * Navbook operations — the verbs of spec 04 §4.3, without a front end.
 *
 * Each operation takes a workspace context and resolved inputs, and returns
 * what happened. Composing the text of a new file, asking the user anything,
 * and phrasing the result are the caller's business: the CLI opens `$EDITOR`
 * and prints, a server reads a request and responds, and both run the same
 * operation in between.
 */

export * from "./doctor.ts";
export * from "./entity.ts";
export * from "./feature.ts";
export * from "./init.ts";
export * from "./issue.ts";
export * from "./pr.ts";
