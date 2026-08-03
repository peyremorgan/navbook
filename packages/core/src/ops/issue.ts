/**
 * Issue operations — spec 04 §4.3.
 *
 * Issues have only the one verb of their own; everything else they do is a
 * shared verb from `entity.ts`.
 */

import type { WsCtx } from "../workspace/index.ts";
import { type CommitOptions, type OpenEntityResult, type OpenInput, openEntity } from "./entity.ts";

/** File a new issue from a composed file. */
export function openIssue(ws: WsCtx, input: OpenInput, opts: CommitOptions): OpenEntityResult {
  return openEntity(ws, "issue", input, opts);
}
