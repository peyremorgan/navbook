/**
 * Linking a Discord account to a person — `doc/spec.md`, "Linking".
 *
 * Two proofs meet here. Discord says who typed `/nav link` (an interaction
 * carries its user, signed by Discord over the bot's own connection); the
 * tracker's sign-in says who opened the page the code was redeemed on. A code
 * is what carries the first to the second: minted for one Discord user,
 * shown only to them, good once and for ten minutes. Redeeming it writes the
 * link into `navbook.json`, as a commit like any other change to the tracker.
 */

import { randomInt } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunPlanResult } from "@navbook/core";
import type { GraphQLCtx, ServerPluginHost } from "@navbook/server/plugin";
import { editPeople, MarkerError } from "../core/marker.ts";

/** Letters and digits nobody misreads for one another. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
export const CODE_TTL_MS = 10 * 60_000;

export interface PendingLink {
  user: string;
  username: string;
  expires: number;
}

export class LinkCodes {
  private readonly codes = new Map<string, PendingLink>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: { ttlMs?: number; now?: () => number } = {}) {
    this.ttlMs = opts.ttlMs ?? CODE_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  /** A new code for `user`, replacing any they had: one live code each. */
  mint(user: string, username: string): string {
    for (const [code, pending] of this.codes) if (pending.user === user) this.codes.delete(code);
    this.sweep();
    let code = "";
    do {
      code = Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join(
        "",
      );
    } while (this.codes.has(code));
    this.codes.set(code, { user, username, expires: this.now() + this.ttlMs });
    return code;
  }

  /** The link a code stands for, if it is live; it stays live until {@link consume}. */
  peek(code: string): PendingLink | null {
    const key = normalize(code);
    const pending = this.codes.get(key);
    if (pending === undefined) return null;
    if (pending.expires <= this.now()) {
      this.codes.delete(key);
      return null;
    }
    return pending;
  }

  /** Spend a code, once the link it stood for is written. */
  consume(code: string): void {
    this.codes.delete(normalize(code));
  }

  private sweep(): void {
    const now = this.now();
    for (const [code, pending] of this.codes) if (pending.expires <= now) this.codes.delete(code);
  }
}

/** A code as somebody may type it: any case, with spaces or a dash in the middle. */
function normalize(code: string): string {
  return code.toUpperCase().replace(/[\s-]+/g, "");
}

/**
 * Edit the `people` map in the served branch's `navbook.json` and commit it,
 * as `ctx`'s viewer, under `docs(discord): <action> <email>`.
 *
 * The same transaction every write is: pulled first, pushed after. A marker
 * that does not declare the plugin is refused with `PRECONDITION`.
 */
export async function writePeople(
  host: ServerPluginHost,
  ctx: GraphQLCtx,
  action: "link" | "unlink",
  email: string,
  edit: (people: Record<string, string>) => void,
): Promise<{ run: RunPlanResult; pushed: boolean }> {
  const { core } = host;
  const { result, pushed } = await ctx.sync.write(
    () => {
      const path = join(ctx.ws.navRoot, core.NAV_MARKER);
      const text = existsSync(path) ? readFileSync(path, "utf8") : undefined;
      let edited: ReturnType<typeof editPeople>;
      try {
        edited = editPeople(text, edit);
      } catch (error) {
        if (error instanceof MarkerError) throw host.api.apiError(error.message, "PRECONDITION");
        throw error;
      }
      return core.runPlan(
        ctx.ws,
        {
          ops: edited.changed ? [{ op: "write", path: core.NAV_MARKER, content: edited.text }] : [],
          message: core.docsScopedSubject("discord", action, email),
          trailers: [],
        },
        { commit: true },
      );
    },
    (run) => run.committed,
  );
  return { run: result, pushed };
}
