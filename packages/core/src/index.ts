/**
 * Navbook — the shared implementation behind every Navbook front end.
 *
 * Four layers, in dependency order (spec 05 §5.2):
 *
 * - `core/`      pure format logic: parse, serialize, validate, query, plan.
 *                No I/O, no git. This is the layer the planned Rust rewrite
 *                must reproduce function for function.
 * - `git/`       every call to the `git` binary.
 * - `workspace/` reading and mutating a real `.navbook/` tree, and the context
 *                an operation runs in.
 * - `ops/`       the verbs of spec 04 §4.3, without a front end: each takes
 *                resolved inputs and returns what happened.
 *
 * The layering is enforced by the directory structure and by review, not by
 * separate entry points: every consumer so far — the CLI, and the API server
 * that will back the web client — runs in Node against a checkout and uses all
 * four.
 */

export * from "./core/index.ts";
export * from "./git/index.ts";
export * from "./ops/index.ts";
export * from "./workspace/index.ts";
