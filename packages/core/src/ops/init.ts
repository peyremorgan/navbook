/**
 * Repository-level operations — spec 04 §4.3.
 */

import { existsSync } from "node:fs";
import { NAVBOOK_ROOT } from "../core/json.ts";
import { planInit } from "../core/ops.ts";
import { type RunPlanResult, runPlan, scanAllIds, type WsCtx, wsFail } from "../workspace/index.ts";
import type { CommitOptions } from "./entity.ts";

/** Create the `.navbook/` skeleton. */
export function initWorkspace(ws: WsCtx, opts: CommitOptions): RunPlanResult {
  if (existsSync(ws.navRoot)) {
    wsFail("already-exists", `${NAVBOOK_ROOT}/ already exists at the repository root`);
  }
  return runPlan(ws, planInit(), { commit: opts.commit });
}

/** Mint fresh IDs, each unique against the tree and against the others. */
export function mintIds(ws: WsCtx, count: number): string[] {
  if (!Number.isInteger(count) || count < 1) {
    wsFail("invalid-input", "--count must be a positive integer");
  }
  const taken = ws.hasNavbook ? scanAllIds(ws.navRoot) : new Set<string>();
  const minted: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = ws.mintId(taken);
    taken.add(id);
    minted.push(id);
  }
  return minted;
}
