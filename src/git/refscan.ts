/**
 * Reading `.navbook/` out of branches that are not checked out.
 *
 * A pull request's files live on the branch it proposes to merge (spec 03
 * §3.5), so listing open PRs means enumerating refs, not walking the working
 * tree. Blobs are read through a single `git cat-file --batch` process so the
 * cost is one subprocess rather than one per file.
 */

import { spawnSync } from "node:child_process";
import { gitMaybe, splitLines, splitNul } from "./exec.ts";

export interface Ref {
  /** Full ref name, e.g. `refs/heads/feat/auth`. */
  full: string;
  /** Short name, e.g. `feat/auth` or `origin/feat/auth`. */
  short: string;
  remote: boolean;
}

/** Local branches and fetched remote branches, excluding symbolic refs. */
export function listBranchRefs(cwd: string): Ref[] {
  const output = gitMaybe(
    [
      "for-each-ref",
      "--format=%(refname)%00%(refname:short)%00%(symref)",
      "refs/heads",
      "refs/remotes",
    ],
    { cwd },
  );
  if (output === null) return [];

  const refs: Ref[] = [];
  for (const line of splitLines(output)) {
    const [full, short, symref] = line.split("\0");
    if (!full || !short) continue;
    // Skip origin/HEAD and friends: they duplicate a branch already listed.
    if (symref !== undefined && symref !== "") continue;
    refs.push({ full, short, remote: full.startsWith("refs/remotes/") });
  }
  return refs;
}

/** Entries directly inside `dir` at `ref`; empty when the path does not exist. */
export function lsTreeNames(cwd: string, ref: string, dir: string): string[] {
  const output = gitMaybe(["ls-tree", "--name-only", "-z", `${ref}:${dir}`], { cwd });
  return output === null ? [] : splitNul(output).map((name) => name.replace(/\/$/, ""));
}

/** Every file path under `dir` at `ref`, recursively. */
export function lsTreeRecursive(cwd: string, ref: string, dir: string): string[] {
  const output = gitMaybe(["ls-tree", "-r", "--name-only", "-z", `${ref}:${dir}`], { cwd });
  return output === null ? [] : splitNul(output);
}

export interface BlobRequest {
  ref: string;
  path: string;
}

/**
 * Read many blobs in one `git cat-file --batch` process.
 *
 * Results are keyed `<ref>:<path>`; missing objects are simply absent, which is
 * the normal case for a branch that has no `.navbook/` at all.
 */
export function catBlobs(cwd: string, requests: readonly BlobRequest[]): Map<string, string> {
  const out = new Map<string, string>();
  if (requests.length === 0) return out;

  const specs = requests.map((request) => `${request.ref}:${request.path}`);
  // No `encoding` option: stdout must stay a Buffer, because the batch protocol
  // frames each blob by byte length rather than by any text delimiter.
  const result = spawnSync("git", ["cat-file", "--batch"], {
    cwd,
    input: `${specs.join("\n")}\n`,
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, LC_ALL: "C" },
  });
  if (result.error || result.status !== 0) return out;

  const stdout = result.stdout;
  let offset = 0;
  for (const spec of specs) {
    const newline = stdout.indexOf(0x0a, offset);
    if (newline === -1) break;
    const header = stdout.subarray(offset, newline).toString("utf8");
    offset = newline + 1;

    // A missing object reports "<spec> missing" and consumes no body.
    const parts = header.split(" ");
    const size = Number(parts[2]);
    if (parts.length < 3 || Number.isNaN(size)) continue;

    out.set(spec, stdout.subarray(offset, offset + size).toString("utf8"));
    offset += size + 1; // the body is followed by a newline
  }
  return out;
}
