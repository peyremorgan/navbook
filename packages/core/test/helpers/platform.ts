/**
 * What a test needs to know about the platform it runs on.
 *
 * The suites run on Linux, macOS and Windows (Git Bash). Most of them mean the
 * same thing on all three; these are the few places where the platform itself
 * differs, gathered so that each test says *why* it does something different
 * rather than testing `process.platform` inline. Every package's tests take
 * them from here — `@navbook/core/test-helpers`, a workspace export like the
 * other packages' — so that one reason is stated once.
 */

import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../../src/git/exec.ts";

/**
 * A fresh temporary directory, by the path git will report for it.
 *
 * Resolved, because `git rev-parse --show-toplevel` answers a real path: the
 * platform's temporary directory is a symlink on macOS, and on Windows it is
 * often spelled with 8.3 short names (`PROBOO~1`) that git expands. `.native`
 * is the resolver that expands them; the JavaScript one leaves them alone.
 */
export function realTempDir(prefix: string): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
}

/**
 * Why symbolic links cannot be made here, or false when they can.
 *
 * Windows lets an ordinary account create them only in Developer Mode; the
 * tests that need one are skipped with this reason rather than failing on
 * `EPERM`, which says nothing about the code under test.
 */
export const NO_SYMLINKS: string | false = (() => {
  const dir = mkdtempSync(join(tmpdir(), "navbook-symlink-probe-"));
  try {
    symlinkSync(dir, join(dir, "link"), "dir");
    return false;
  } catch {
    return "this account cannot create symbolic links (on Windows, enable Developer Mode)";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

/**
 * Why a file cannot be made unreadable to its owner here, or false when it can.
 *
 * `chmod 000` takes the read permission away on POSIX. On Windows, Node maps
 * mode bits to the read-only attribute alone, which never stops a read, so a
 * test that needs an unreadable file has nothing to stand on. Root reads
 * through any mode, so it is the same answer there.
 */
export const NO_UNREADABLE_FILES: string | false =
  process.platform === "win32"
    ? "Windows file modes cannot take away the owner's read access"
    : process.getuid?.() === 0
      ? "root reads files whatever their mode"
      : false;

/**
 * Why git cannot be replaced by a script for one test, or false when it can.
 *
 * A test that needs git to fail on cue, or to report what it was asked, puts a
 * shell script named `git` first on `PATH`. Windows launches only programs it
 * recognises by extension, and Node will not launch a `.cmd` without a shell,
 * so such a script is never the `git` that runs there.
 */
export const NO_GIT_SHIM: string | false =
  process.platform === "win32" ? "Windows will not launch a shell script named git" : false;

/**
 * Why a test cannot signal a process group as a terminal's Ctrl-C does, or
 * false when it can. Windows has neither process groups nor `kill -INT 0`.
 */
export const NO_PROCESS_GROUPS: string | false =
  process.platform === "win32" ? "Windows has no process groups for Ctrl-C to signal" : false;

/**
 * Whether a process can be asked to stop before it is made to.
 *
 * POSIX sends SIGTERM and waits a grace period before SIGKILL. Windows has no
 * request a console process can honour, so a stop there is the kill at once.
 */
export const POLITE_STOP = process.platform !== "win32";

/**
 * Why stopping a process group may leave a backgrounded grandchild running, or
 * false when it cannot.
 *
 * On Windows a group stop kills the process tree by parentage. A job a shell
 * puts in the background (`sleep &`) is started by Git Bash's emulation of
 * `fork`, whose intermediate process exits, so the job has no living parent
 * and no tree walk reaches it. Git and everything still parented to it stop.
 */
export const ORPHANS_OUTLIVE_STOP: string | false =
  process.platform === "win32"
    ? "a job Git Bash backgrounds is orphaned by its fork emulation, out of reach of a tree kill"
    : false;

/**
 * Shell snippets printing the pid of the last background job, and of the shell
 * itself, as `process.kill` knows them.
 *
 * Git for Windows runs scripts under its MSYS shell, whose `$!` and `$$` are
 * MSYS's own numbers; the Windows one is in `/proc/<pid>/winpid`. Everywhere
 * else that file does not exist, and the number is the one the shell gave.
 * Read with the `read` builtin rather than `cat`: starting a process costs a
 * Windows shell long enough to matter to a test timing a stop in milliseconds.
 */
export const PID_OF_LAST = '{ read -r w 2>/dev/null < "/proc/$!/winpid" && echo "$w" || echo $!; }';
export const PID_OF_SELF = '{ read -r w 2>/dev/null < "/proc/$$/winpid" && echo "$w" || echo $$; }';

/**
 * Put a file in a repository's index without writing it to disk.
 *
 * For names a repository can hold and a filesystem cannot — `"`, `:`, `*` or a
 * newline on Windows. Git for Windows refuses such a name in the index by
 * default, to protect a checkout; nothing a test records this way is ever
 * checked out, so that protection is lifted for this one command.
 */
export function recordInIndex(dir: string, path: string, content: string): void {
  const blob = git(["hash-object", "-w", "--stdin"], { cwd: dir, input: content }).trim();
  git(
    [
      "-c",
      "core.protectNTFS=false",
      "update-index",
      "--add",
      "--cacheinfo",
      `100644,${blob},${path}`,
    ],
    { cwd: dir },
  );
}
