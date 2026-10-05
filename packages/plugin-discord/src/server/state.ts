/**
 * What the bridge keeps between runs — `doc/spec.md`, "What the bridge keeps".
 *
 * A file in the clone's git directory, beside what git itself keeps there:
 * outside the working tree, so it is never committed and never makes the
 * clone dirty, and in the volume the clone lives in, so it survives a restart.
 * It is disposable (spec 06 §6.6). Lost, the bridge starts from the tracker as
 * it is then, with no replay, and finds its threads again by their names.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Seen } from "./model.ts";

/** A thread the bridge keeps for a record. Its id is also its card's: Discord gives both one. */
export interface ThreadRef {
  thread: string;
  /** The channel the thread is in: a forum, or a text channel holding the card. */
  parent: string;
  forum: boolean;
  /** The name it was last given, and when, since Discord allows few renames. */
  name: string;
  renamedAt: number;
  archived: boolean;
  /** The forum tags it carries. */
  tags: string[];
  /** A hash of the card as last drawn; null when it is unknown. */
  card: string | null;
}

export interface BridgeState {
  version: 1;
  /** Every record as last seen; null until the bridge first looked. */
  seen: Record<string, Seen> | null;
  threads: Record<string, ThreadRef>;
  /**
   * The keys of the messages already posted, oldest first, so a run tried
   * again after failing part of the way does not post them twice.
   */
  told: string[];
}

/** How many keys are kept: enough to cover any run tried again. */
export const TOLD_LIMIT = 5_000;

export function emptyState(): BridgeState {
  return { version: 1, seen: null, threads: {}, told: [] };
}

export class StateFile {
  readonly path: string;
  private readonly report: (line: string) => void;

  constructor(path: string, report: (line: string) => void) {
    this.path = path;
    this.report = report;
  }

  /** The state as last saved, or an empty one — said once when it was there and unreadable. */
  load(): BridgeState {
    let text: string;
    try {
      text = readFileSync(this.path, "utf8");
    } catch {
      return emptyState();
    }
    try {
      const parsed = JSON.parse(text) as Partial<BridgeState>;
      if (parsed.version !== 1 || typeof parsed.threads !== "object" || parsed.threads === null) {
        throw new Error("not a state this bridge wrote");
      }
      return {
        version: 1,
        seen: parsed.seen && typeof parsed.seen === "object" ? parsed.seen : null,
        threads: parsed.threads,
        told: Array.isArray(parsed.told) ? parsed.told : [],
      };
    } catch (error) {
      this.report(
        `discarding ${this.path} (${error instanceof Error ? error.message : String(error)}); ` +
          "starting from the tracker as it is now",
      );
      return emptyState();
    }
  }

  /** Write it whole, through a temporary file, so a crash leaves the old one or the new. */
  save(state: BridgeState): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(state)}\n`, "utf8");
    renameSync(temporary, this.path);
  }
}
