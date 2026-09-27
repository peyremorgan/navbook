/**
 * Housekeeping for the clone, run by the server rather than behind its back (#cvb57nhm).
 *
 * Left to itself, git follows a commit, a fetch or a merge with `git
 * maintenance run --auto --detach`: a process in a session of its own, which
 * no drain waits for and no signal the server receives reaches. A container
 * stopping mid-repack SIGKILLs it, and what it leaves — a `packed-refs.lock`
 * above all — fails every request after the next start. So `main.ts` turns
 * that off (`maintenance.auto=false`), and this runs the same housekeeping as
 * a child the server owns: in the foreground, in a process group it can stop
 * whole, and no more often than `--maintenance-interval-ms`.
 *
 * It runs beside requests rather than between them. Git's maintenance tasks
 * are written to be safe beside other gits — the geometric repack and the
 * incremental commit-graph write both say so — and a repack that held the
 * clone would be every request's latency for as long as it took.
 */

import { type GitResult, GitStoppedError, GitTimeoutError, gitRunAsync } from "@navbook/core";

/**
 * The command, which stays in the foreground: the server waits for it.
 *
 * `maintenance run` without `--detach` runs its tasks as children it waits
 * for, and since git 2.47 tells its `gc` task `--no-detach` whatever the
 * configuration says. An older git's `gc` task was a plain `gc --auto`, which
 * detaches unless `gc.autoDetach` is off — so that is turned off here too.
 * (`maintenance.autoDetach` only decides how git starts maintenance by
 * itself, which `main.ts` turns off altogether.)
 */
export const MAINTENANCE_ARGS: readonly string[] = [
  "-c",
  "gc.autoDetach=false",
  "maintenance",
  "run",
  "--auto",
  "--quiet",
];

/** How long one run may take before it is stopped: no repack should come close. */
export const RUN_LIMIT_MS = 30 * 60_000;

/** How long a shutdown waits for a run to finish before stopping it. */
export const STOP_BUDGET_MS = 5_000;

export interface MaintenanceOptions {
  repoRoot: string;
  /** The least time between the starts of two runs; 0 runs none. */
  intervalMs: number;
  report?: (line: string) => void;
  now?: () => number;
  /** Run maintenance once; the real one runs git. Rejects as `gitRunAsync` does. */
  run?: (opts: { signal: AbortSignal; timeoutMs: number }) => Promise<GitResult>;
  /**
   * Clear up after a run that ran out of time, given when it started.
   *
   * Only for a run stopped while the server goes on: one stopped by a
   * shutdown is cleared up at the next start, when nothing else can be
   * writing the same kind of file.
   */
  tidy?: (since: number) => Promise<void>;
  runLimitMs?: number;
  stopBudgetMs?: number;
}

export class Maintenance {
  private readonly opts: MaintenanceOptions;
  private readonly now: () => number;
  private readonly report: (line: string) => void;
  private readonly stopper = new AbortController();
  private running: Promise<void> | null = null;
  private lastStart = Number.NEGATIVE_INFINITY;
  private stopping = false;
  /** Whether the latest run failed, so a failing streak is said once. */
  private failing = false;

  constructor(opts: MaintenanceOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.report = opts.report ?? (() => undefined);
  }

  /** Whether the server runs maintenance at all. */
  get enabled(): boolean {
    return this.opts.intervalMs > 0;
  }

  /**
   * Run maintenance, unless it would be too soon.
   *
   * Returns at once. A request while a run is going, within the interval of
   * the last one's start, or once stopping has begun, is dropped rather than
   * queued: the next pull asks again.
   */
  request(): void {
    if (!this.enabled || this.stopping || this.running !== null) return;
    const now = this.now();
    if (now - this.lastStart < this.opts.intervalMs) return;
    this.lastStart = now;
    this.running = this.once(now).finally(() => {
      this.running = null;
    });
  }

  /**
   * Stop for good: wait a little for a run in progress, then stop it.
   *
   * A run that finishes leaves nothing behind, so it is given the budget
   * first. Past it, the whole run is told to stop — git removes its lock
   * files when asked — and killed if it does not. Never throws.
   */
  async stop(): Promise<void> {
    this.stopping = true;
    const running = this.running;
    if (running === null) return;
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), this.opts.stopBudgetMs ?? STOP_BUDGET_MS);
    });
    const tooLate = await Promise.race([running.then(() => false), late]);
    clearTimeout(timer);
    if (tooLate) {
      this.report("nav-server: stopping git maintenance to shut down");
      this.stopper.abort();
      await running;
    }
  }

  private async once(started: number): Promise<void> {
    const limit = this.opts.runLimitMs ?? RUN_LIMIT_MS;
    try {
      const result = await this.run({ signal: this.stopper.signal, timeoutMs: limit });
      if (result.code === 0) {
        if (this.failing) this.report("nav-server: git maintenance recovered");
        this.failing = false;
        return;
      }
      if (!this.failing) {
        this.report(
          `nav-server: git maintenance failed (exit ${result.code}): ${result.stderr.trim()}`,
        );
      }
      this.failing = true;
    } catch (error) {
      if (error instanceof GitStoppedError) return;
      if (error instanceof GitTimeoutError) {
        this.report(`nav-server: git maintenance ran past ${limit} ms and was stopped`);
        await this.tidy(started);
        return;
      }
      this.report(`nav-server: git maintenance could not run: ${message(error)}`);
    }
  }

  private run(opts: { signal: AbortSignal; timeoutMs: number }): Promise<GitResult> {
    if (this.opts.run) return this.opts.run(opts);
    return gitRunAsync([...MAINTENANCE_ARGS], {
      cwd: this.opts.repoRoot,
      processGroup: true,
      ...opts,
    });
  }

  private async tidy(since: number): Promise<void> {
    try {
      await this.opts.tidy?.(since);
    } catch (error) {
      this.report(`nav-server: could not clear up after git maintenance: ${message(error)}`);
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
