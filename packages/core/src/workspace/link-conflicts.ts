/**
 * Deciding a disputed parent from git history — the repairable half of check
 * D11 (spec 04 §4.3).
 *
 * When two issues each claim the same subtask, the tree cannot say which is
 * right: both files are equally well-formed, and both assertions were made on
 * purpose by somebody. History can, because it records *when* each claim was
 * made, and the later one is the one that was meant to replace the other.
 *
 * Where history is silent the resolver says so rather than guessing. A claim
 * that was never committed, one whose file is missing from a shallow clone, and
 * two claims made in the same commit are all cases where picking a winner would
 * mean deleting an assertion on no evidence, so the fault is left for a person.
 */

import { parseFile, readParent, readSubtasks } from "../core/files.ts";
import type { LinkConflict } from "../core/links.ts";
import { blobAt, fileVersions } from "../git/history.ts";
import type { WsCtx } from "./ctx.ts";
import { repoPath } from "./workspace.ts";

/** When a file last started asserting something, read from its own history. */
type FactTimer = (filePath: string, holds: (fm: Record<string, unknown>) => boolean) => Date | null;

/**
 * A resolver for {@link LinkConflict}s backed by `git log` over the files that
 * make each claim. Returns the winning parent's id, or null to leave the fault
 * unrepaired.
 */
export function gitLinkConflictResolver(ws: WsCtx): (fault: LinkConflict) => string | null {
  const timer = makeFactTimer(ws);
  return (fault) => decideConflict(fault, timer);
}

/** The resolution rule itself, with history supplied — the testable half. */
export function decideConflict(fault: LinkConflict, when: FactTimer): string | null {
  let best: { id: string; at: Date } | null = null;
  let tied = false;

  for (const id of fault.claimants) {
    const at = claimedAt(fault, id, when);
    // One unreadable claim is enough to sink the decision: it may well be the
    // newest, and a repair would then remove the assertion that was meant.
    if (at === null) return null;
    if (best === null || at.getTime() > best.at.getTime()) {
      best = { id, at };
      tied = false;
    } else if (at.getTime() === best.at.getTime()) {
      tied = true;
    }
  }
  return best === null || tied ? null : best.id;
}

/**
 * When a claim was last made, across every file that makes it.
 *
 * A claim can be recorded twice — the child naming its parent and that parent
 * listing the child — and the later of the two is when it was last reaffirmed.
 */
function claimedAt(fault: LinkConflict, claimant: string, when: FactTimer): Date | null {
  const times: Date[] = [];

  if (readParent(fault.child.fm) === claimant) {
    const at = when(fault.child.filePath, (fm) => readParent(fm) === claimant);
    if (at === null) return null;
    times.push(at);
  }

  const lister = fault.listers.find((entity) => entity.id === claimant);
  if (lister) {
    const at = when(lister.filePath, (fm) => readSubtasks(fm).includes(fault.child.id));
    if (at === null) return null;
    times.push(at);
  }

  if (times.length === 0) return null;
  return times.reduce((latest, at) => (at.getTime() > latest.getTime() ? at : latest));
}

/**
 * Read a file's history and report when it last began asserting something.
 *
 * Facts are compared, not bytes: an uncommitted edit to the description does
 * not make the link claim undecidable, but an uncommitted edit to the claim
 * itself does — nothing in history stands behind it yet.
 */
function makeFactTimer(ws: WsCtx): FactTimer {
  const cache = new Map<string, { fm: Record<string, unknown>; at: Date }[]>();

  return (filePath, holds) => {
    let history = cache.get(filePath);
    if (!history) {
      history = [];
      for (const version of fileVersions(ws.repoRoot, repoPath(filePath))) {
        const text = blobAt(ws.repoRoot, version.sha, version.path);
        if (text === null) continue;
        try {
          history.push({ fm: parseFile(text).fm, at: version.authored });
        } catch {
          // A malformed historical version is check D2's business, not this one.
        }
      }
      cache.set(filePath, history);
    }

    const last = history[history.length - 1];
    // Never committed, or committed but since edited: history cannot vouch.
    if (!last || !holds(last.fm)) return null;

    let since = last.at;
    for (let i = history.length - 1; i > 0; i--) {
      if (!holds((history[i - 1] as { fm: Record<string, unknown> }).fm)) break;
      since = (history[i - 1] as { at: Date }).at;
    }
    return since;
  };
}
