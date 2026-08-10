/**
 * Navbook workspace — reading and mutating a real `.navbook/` tree on disk.
 *
 * Everything `core/` plans, this layer executes: it owns the filesystem, the
 * index, and the context an operation runs in. It is shared by every front end
 * that works against a checkout (spec 05 §5.2).
 */

export * from "./commit-flow.ts";
export * from "./ctx.ts";
export * from "./errors.ts";
export * from "./history-checks.ts";
export * from "./link-conflicts.ts";
export * from "./resolve.ts";
export * from "./workspace.ts";
