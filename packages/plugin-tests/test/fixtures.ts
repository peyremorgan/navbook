/**
 * Files the suites build trees from: a plan, a pull request, and runs of the
 * plan, each with the fields a case needs changed and the rest sound.
 */

export const HEAD1 = "4f2c9d1e8a7b3c5d9e0f1a2b3c4d5e6f7a8b9c0d";
export const HEAD2 = "5a3d0e2f9b8c4d6e0f1a2b3c4d5e6f7a8b9c0d1e";
const BASE = "91d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0";

/** A run's file name, without `.md`: its stamp and its ID. */
export function runName(stamp: string, id: string): string {
  return `${stamp}-${id}`;
}

/** A plan with `steps` steps (two by default), or with `title` left out when null. */
export function plan(opts: { title?: string | null; steps?: number } = {}): string {
  const lines = ["---"];
  if (opts.title !== null) lines.push(`title: ${opts.title ?? "Login flow"}`);
  lines.push(
    "author: Alice Smith <alice@example.com>",
    "created: 2026-09-20T10:00:00Z",
    "---",
    "",
    "Sign in from a clean profile.",
  );
  const titles = ["Open the login page", "Sign in with a valid account", "Log out"];
  for (let step = 0; step < (opts.steps ?? 2); step++) {
    lines.push(
      "",
      `### ${titles[step] ?? `Step ${step + 1}`}`,
      "",
      "#### Actions",
      "",
      `Do thing ${step + 1}.`,
      "",
      "#### Expected",
      "",
      `Thing ${step + 1} happens.`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** A pull request whose revisions have these heads. */
export function pr(heads: readonly string[] = [HEAD1]): string {
  const lines = [
    "---",
    "title: Auth refactor",
    "author: ked@example.com",
    "created: 2026-09-21T08:00:00Z",
    "target: main",
    "source: feat/auth",
    "revisions:",
  ];
  for (const head of heads)
    lines.push(`  - head: ${head}`, `    base: ${BASE}`, "    date: 2026-09-21T08:00:00Z");
  lines.push("---", "", "Refactor.");
  return `${lines.join("\n")}\n`;
}

export interface RunOptions {
  plan?: string;
  planSha?: string;
  /** How many steps the plan had; null leaves the key out. */
  steps?: number | null;
  /** The commit tested; null leaves the key out. */
  commit?: string | null;
  version?: string | null;
  finished?: boolean;
  results?: [number, string, string?][];
  /** Frontmatter lines added verbatim. */
  raw?: string;
}

/** A run of the plan, against HEAD1 by default, recording `results`. */
export function run(opts: RunOptions = {}): string {
  const lines = ["---", `plan: ${opts.plan ?? "login"}`];
  if (opts.planSha !== undefined) lines.push(`plan-sha: ${opts.planSha}`);
  if (opts.steps !== null) lines.push(`steps: ${opts.steps ?? 2}`);
  lines.push("author: Bob Jones <bob@example.com>", "started: 2026-09-21T09:00:00Z");
  if (opts.finished) lines.push("finished: 2026-09-21T09:30:00Z");
  if (opts.commit !== null) lines.push(`commit: ${opts.commit ?? HEAD1}`);
  if (opts.version !== undefined && opts.version !== null) lines.push(`version: "${opts.version}"`);
  if (opts.raw !== undefined) lines.push(opts.raw);
  lines.push("---");
  for (const [number, status, actual] of opts.results ?? []) {
    lines.push("", `### ${number}. Step ${number}`, "", "#### Status", "", status);
    if (actual !== undefined) lines.push("", "#### Actual", "", actual);
  }
  return `${lines.join("\n")}\n`;
}
