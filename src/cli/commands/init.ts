/**
 * `nav init` and `nav id` — the repository-level utilities of spec 04 §4.3.
 */

import { existsSync } from "node:fs";
import { NAVBOOK_ROOT } from "../../core/json.ts";
import { planInit } from "../../core/ops.ts";
import { allIds } from "../../core/tree.ts";
import { commitReport, runPlan } from "../commit-flow.ts";
import type { Ctx } from "../context.ts";
import { fail } from "../errors.ts";
import { loadRepo } from "../workspace.ts";
import type { GlobalFlags } from "./entity.ts";

/** Create the `.navbook/` skeleton. */
export function cmdInit(ctx: Ctx, opts: GlobalFlags): void {
  if (existsSync(ctx.navRoot)) {
    fail(`${NAVBOOK_ROOT}/ already exists at the repository root`);
  }
  const plan = planInit();
  runPlan(ctx, plan, { commit: opts.commit });
  ctx.stdout.write(`Created ${NAVBOOK_ROOT}/\n`);
  ctx.stdout.write(`Next: nav issue open "Something is broken"\n`);
  if (opts.commit) ctx.stdout.write(`${commitReport(plan)}\n`);
}

/** Mint and print a fresh ID, for hand-editors and scripts. */
export function cmdId(ctx: Ctx, opts: { count?: number }): void {
  const taken = new Set<string>();
  if (ctx.hasNavbook) {
    for (const entry of allIds(loadRepo(ctx))) taken.add(entry.id);
  }
  const count = opts.count ?? 1;
  if (!Number.isInteger(count) || count < 1) fail("--count must be a positive integer");
  for (let i = 0; i < count; i++) {
    const id = ctx.mintId(taken);
    taken.add(id);
    ctx.stdout.write(`${id}\n`);
  }
}
