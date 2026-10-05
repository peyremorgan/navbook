/** Records parsed from file text, the way the server's tree reads them. */

import type { EntityRecord, NavTree } from "@navbook/core";
import * as core from "@navbook/core";

export const HEAD = "4f2c9d1e8a7b3c5d9e0f1a2b3c4d5e6f7a8b9c0d";
export const BASE = "91d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0";
export const HEAD_2 = "0011223344556677889900aabbccddeeff001122";

export interface RecordOptions {
  id?: string;
  status?: string;
  /** Extra frontmatter lines, each ending in a newline. */
  fm?: string;
  title?: string;
  body?: string;
  /** Comment files: `<stamp>-<id>.md` to their text. */
  comments?: Record<string, string>;
}

export function issue(opts: RecordOptions = {}): EntityRecord {
  const id = opts.id ?? "iss11111";
  const dir = `issues/${opts.status ?? "open"}/${id}-the-issue`;
  return parse(
    dir,
    "issue.md",
    `---\ntitle: ${opts.title ?? "Login times out"}\nauthor: Alice Smith <alice@example.com>\ncreated: 2026-08-02T09:14:00Z\n${opts.fm ?? ""}---\n\n${opts.body ?? "It aborts after 5 s."}\n`,
    opts.comments,
  );
}

export function pr(opts: RecordOptions = {}): EntityRecord {
  const id = opts.id ?? "pr111111";
  const dir = `prs/${opts.status ?? "open"}/${id}-the-change`;
  return parse(
    dir,
    "pr.md",
    `---\ntitle: ${opts.title ?? "Fix the login"}\nauthor: Bob <bob@example.com>\ncreated: 2026-08-04T16:40:00Z\ntarget: main\nsource: fix-login\n${opts.fm ?? `revisions:\n  - head: ${HEAD}\n    base: ${BASE}\n    date: 2026-08-04T16:40:00Z\n`}---\n\n${opts.body ?? "Retries once."}\n`,
    opts.comments,
  );
}

export function comment(author: string, body: string, extra = ""): string {
  return `---\nauthor: ${author}\n${extra}---\n\n${body}\n`;
}

function parse(
  dir: string,
  main: string,
  text: string,
  comments: Record<string, string> = {},
): EntityRecord {
  const files = new Map<string, string>([[`${dir}/${main}`, text]]);
  for (const [name, content] of Object.entries(comments))
    files.set(`${dir}/comments/${name}`, content);
  const repo = core.parseTree(files as unknown as NavTree);
  const record = [...repo.issues, ...repo.prs][0];
  if (record === undefined)
    throw new Error(`nothing parsed from ${dir}: ${JSON.stringify(repo.problems)}`);
  return record;
}
