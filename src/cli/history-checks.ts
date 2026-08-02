/**
 * The doctor checks that need git archaeology — spec 04 §4.3, D7, D9 and D10.
 *
 * Their decision logic lives in `core/validate.ts`; this module supplies the
 * history those pure functions judge. Every check degrades to silence when the
 * history is unavailable (a shallow clone, an unfetched commit), because an
 * absent object is not evidence of a fault.
 */

import { parseFile, readRevisions } from "../core/files.ts";
import { parseIso } from "../core/time.ts";
import { allEntities, type Repo } from "../core/tree.ts";
import {
  checkRevisionsAppendOnly,
  checkTimestampSkew,
  type Diagnostic,
  planD9Fix,
} from "../core/validate.ts";
import { addedAt, blobAt, fileVersions, isAncestor, objectExists } from "../git/history.ts";
import { currentBranch, resolveSha } from "../git/repo.ts";
import type { Ctx } from "./context.ts";
import { repoPath } from "./workspace.ts";

/**
 * How far a frontmatter timestamp may sit from the commit that introduced it
 * before D10 calls it inconsistent.
 *
 * The specification says "wildly inconsistent" without a number. Two days
 * absorbs offline work, a delayed push and any timezone confusion, while still
 * catching a timestamp that was copied or typed from the wrong year.
 */
export const TIMESTAMP_SKEW_HOURS = 48;

export function runHistoryChecks(ctx: Ctx, repo: Repo): Diagnostic[] {
  return [
    ...checkAppendOnly(ctx, repo),
    ...checkMergedButOpen(ctx, repo),
    ...checkTimestamps(ctx, repo),
  ];
}

/* ------------------------------------------- D7: revisions are append-only */

function checkAppendOnly(ctx: Ctx, repo: Repo): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const pr of repo.prs) {
    const versions = fileVersions(ctx.repoRoot, repoPath(pr.filePath));
    if (versions.length < 2) continue;

    const lists = [];
    for (const version of versions) {
      const text = blobAt(ctx.repoRoot, version.sha, version.path);
      if (text === null) continue;
      try {
        lists.push(readRevisions(parseFile(text).fm));
      } catch {
        // A malformed historical version is D2's business, not D7's.
      }
    }

    const result = checkRevisionsAppendOnly(lists);
    if (result.ok) continue;
    out.push({
      check: "D7",
      level: "error",
      path: pr.filePath,
      message: `revisions must only be appended to (§2.7): ${result.message}`,
    });
  }
  return out;
}

/* ------------------------------------ D9: merged but not archived (03 §3.5) */

function checkMergedButOpen(ctx: Ctx, repo: Repo): Diagnostic[] {
  const head = resolveSha(ctx.repoRoot, "HEAD");
  if (!head) return [];
  // "Merged" only means anything on the branch the PR asked to merge into. On
  // its own source branch the head is trivially an ancestor of HEAD, and on an
  // unrelated branch containing it the fact is not actionable.
  const branch = currentBranch(ctx.repoRoot);
  if (!branch) return [];

  const out: Diagnostic[] = [];
  for (const pr of repo.prs) {
    if (pr.status !== "open") continue;
    if (pr.fm.target !== branch) continue;
    const revisions = readRevisions(pr.fm);
    const latest = revisions[revisions.length - 1];
    // An unfetched head is not evidence of anything.
    if (!latest || !objectExists(ctx.repoRoot, latest.head)) continue;
    if (!isAncestor(ctx.repoRoot, latest.head, head)) continue;

    out.push({
      check: "D9",
      level: "warning",
      path: pr.dirPath,
      message: `#${pr.id} is merged into this branch but still filed under prs/open/; move it to prs/merged/`,
      fix: planD9Fix(pr),
    });
  }
  return out;
}

/* --------------------------------- D10: timestamps versus the commit record */

function checkTimestamps(ctx: Ctx, repo: Repo): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const entity of allEntities(repo)) {
    // An entity whose timestamps legitimately predate the commit that carries
    // them: bulk-imported from a forge (§2.4), or archived from an era the
    // visible history may no longer reach (03 §3.6).
    if (entity.archived || entity.fm["imported-from"] !== undefined) continue;

    const created = typeof entity.fm.created === "string" ? parseIso(entity.fm.created) : null;
    if (created) {
      const added = addedAt(ctx.repoRoot, repoPath(entity.filePath));
      if (added && !checkTimestampSkew(created, added.authored, TIMESTAMP_SKEW_HOURS)) {
        out.push({
          check: "D10",
          level: "warning",
          path: entity.filePath,
          message: `'created: ${entity.fm.created}' is more than ${TIMESTAMP_SKEW_HOURS}h from the commit that added it (${added.authored.toISOString().slice(0, 10)})`,
        });
      }
    }

    for (const comment of entity.comments) {
      const added = addedAt(ctx.repoRoot, repoPath(comment.path));
      if (!added) continue;
      if (checkTimestampSkew(comment.date, added.authored, TIMESTAMP_SKEW_HOURS)) continue;
      out.push({
        check: "D10",
        level: "warning",
        path: comment.path,
        message: `the filename timestamp is more than ${TIMESTAMP_SKEW_HOURS}h from the commit that added it (${added.authored.toISOString().slice(0, 10)})`,
      });
    }
  }
  return out;
}
