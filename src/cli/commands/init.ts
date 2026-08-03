/**
 * `nav init` and `nav id` — the repository-level utilities of spec 04 §4.3.
 */

import { NAVBOOK_ROOT } from "../../core/json.ts";
import { initWorkspace, mintIds } from "../../ops/index.ts";
import { commitReport } from "../../workspace/index.ts";
import type { Ctx } from "../context.ts";
import type { GlobalFlags } from "./entity.ts";

/** Create the `.navbook/` skeleton. */
export function cmdInit(ctx: Ctx, opts: GlobalFlags): void {
  const result = initWorkspace(ctx, { commit: opts.commit });
  ctx.stdout.write(`Created ${NAVBOOK_ROOT}/\n`);
  if (opts.commit) {
    ctx.stdout.write(`${commitReport(result)}\n`);
  } else {
    // Say so plainly: a later --commit refuses to run while this is staged.
    ctx.stdout.write("The skeleton is staged; commit it, or re-run with --commit.\n");
  }
  ctx.stdout.write(`Next: nav issue open "Something is broken"\n`);
}

/** Mint and print fresh IDs, for hand-editors and scripts. */
export function cmdId(ctx: Ctx, opts: { count?: number }): void {
  for (const id of mintIds(ctx, opts.count ?? 1)) ctx.stdout.write(`${id}\n`);
}
