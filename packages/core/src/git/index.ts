/**
 * Navbook's git layer — every call to the `git` binary, and nothing else.
 *
 * Navbook shells out rather than linking a library, so its git behavior is
 * definitionally the user's git (spec 05 §5.2). Each function takes the
 * repository it works in as its first argument; none of them holds state.
 */

export * from "./config.ts";
export * from "./diff.ts";
export * from "./exec.ts";
export * from "./history.ts";
export * from "./index-ops.ts";
export * from "./merge.ts";
export * from "./merge-state.ts";
export * from "./refscan.ts";
export * from "./remote.ts";
export * from "./repo.ts";
