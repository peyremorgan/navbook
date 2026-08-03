/**
 * Terminal color, enabled only for a TTY that has not opted out.
 *
 * `--json` output and every fixture comparison therefore run uncolored.
 */

import pc from "picocolors";

export type Colors = ReturnType<typeof pc.createColors>;

export function colorEnabled(stream: { isTTY?: boolean }, env: NodeJS.ProcessEnv): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "" && env.FORCE_COLOR !== "0")
    return true;
  if (env.TERM === "dumb") return false;
  return stream.isTTY === true;
}

export function makeColors(stream: { isTTY?: boolean }, env: NodeJS.ProcessEnv): Colors {
  return pc.createColors(colorEnabled(stream, env));
}
