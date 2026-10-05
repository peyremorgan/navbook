/**
 * Files the suites build trees from: an issue, a poll on it, and votes, each
 * with the fields a case needs changed and the rest sound.
 */

import * as core from "@navbook/core";
import { type ExtensionParts, mergeExtensions } from "@navbook/core";
import { fingerprint, readPoll, useCore } from "../src/core/files.ts";
import { activate } from "../src/core/index.ts";

// The fixtures read polls at load, before any suite activates the plugin.
useCore(core);

/** The format extensions this plugin registers, as a front end would load them. */
export function extensions() {
  const parts: ExtensionParts[] = [];
  activate({
    core,
    manifest: { short: "poll" },
    settings: {},
    register: (part) => void parts.push(part),
  });
  return mergeExtensions(parts);
}

export const ISSUE_ID = "k3m9x2q1";
export const ISSUE_DIR = `issues/open/${ISSUE_ID}-attachments`;
export const POLL_ID = "p4w8n2x6";
export const POLL_DIR = `${ISSUE_DIR}/poll/${POLL_ID}-attachment-storage`;

/** An issue, filed by Ivy and assigned to Ada unless told otherwise. */
export function issue(opts: { author?: string; assignee?: string | null } = {}): string {
  const lines = [
    "---",
    "title: Attachments",
    `author: ${opts.author ?? "Ivy Issuer <ivy@example.com>"}`,
    "created: 2026-10-01T09:00:00Z",
  ];
  if (opts.assignee !== null)
    lines.push(`assignee: ${opts.assignee ?? "Ada Assignee <ada@example.com>"}`);
  lines.push("---", "", "Issues need attachments.");
  return `${lines.join("\n")}\n`;
}

/** The questions of the spec's example (§3), as YAML lines under `questions:`. */
export const QUESTIONS = [
  "questions:",
  "  - id: backend",
  "    text: Which storage backend?",
  "    other: true",
  "    options:",
  "      - id: s3",
  "        label: S3-compatible",
  "        description: |",
  "          Cheap and durable; the server needs credentials in its environment.",
  "      - id: disk",
  "        label: Local disk",
  "  - id: limits",
  "    text: Which limits do we enforce?",
  "    multi: true",
  "    options:",
  "      - { id: size, label: Max file size }",
  "      - { id: count, label: Max files per issue }",
].join("\n");

export interface PollOptions {
  title?: string | null;
  /** YAML for `questions:` and below; the spec's example by default. */
  questions?: string;
  /** Frontmatter lines added verbatim. */
  raw?: string;
  closed?: string;
  closedBy?: string;
  preamble?: string;
}

/** A poll, open unless `closed` is given. */
export function poll(opts: PollOptions = {}): string {
  const lines = ["---"];
  if (opts.title !== null) lines.push(`title: ${opts.title ?? "Attachment storage"}`);
  lines.push(
    "author: Claude <noreply@anthropic.com>",
    "created: 2026-10-04T10:00:00Z",
    opts.questions ?? QUESTIONS,
  );
  if (opts.closed !== undefined) {
    lines.push(
      `closed: ${opts.closed}`,
      `closed-by: ${opts.closedBy ?? "Ada Assignee <ada@example.com>"}`,
    );
  }
  if (opts.raw !== undefined) lines.push(opts.raw);
  lines.push("---", "", opts.preamble ?? "Where do we keep attachments?");
  return `${lines.join("\n")}\n`;
}

/** The fingerprint of a poll's questions as its text reads. */
export function fingerprintOf(text: string): string {
  return fingerprint(readPoll(core.parseFile(text)).questions);
}

/** The fingerprint of the default poll's questions. */
export const CURRENT = fingerprintOf(poll());

/** The spec's own vector for its example (§5). */
export const SPEC_VECTOR = "494fd6745530e75d";

export interface VoteOptions {
  author?: string;
  fingerprint?: string | null;
  /** YAML for `answers:` and below, or `{}`. */
  answers?: string;
  note?: string;
}

/** A vote by Bob for S3 and the size limit, on the default poll's questions. */
export function vote(opts: VoteOptions = {}): string {
  const lines = ["---", `author: ${opts.author ?? "Bob Voter <bob@example.com>"}`];
  if (opts.fingerprint !== null) lines.push(`fingerprint: ${opts.fingerprint ?? CURRENT}`);
  lines.push(
    opts.answers ??
      ["answers:", "  backend: { picks: [s3] }", "  limits: { picks: [size] }"].join("\n"),
    "---",
  );
  if (opts.note !== undefined) lines.push("", opts.note);
  return `${lines.join("\n")}\n`;
}

/** A vote file's path in the default poll, from its stamp and ID. */
export function votePath(stamp: string, id: string, dir = POLL_DIR): string {
  return `${dir}/${stamp}-${id}.md`;
}

/** The default answers, as YAML. */
export const answers = (...lines: string[]): string => ["answers:", ...lines].join("\n");
