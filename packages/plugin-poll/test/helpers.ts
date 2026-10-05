/**
 * What the CLI suites share: a repository with this plugin on the path, an
 * issue to ask in, and the poll every suite asks.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeNavRepo, type TempRepo } from "@navbook/cli/test-helpers";

/** This package, as `NAVBOOK_PLUGIN_PATH` names it. */
export const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A repository with this plugin installed and declared, its path folded into
 * `nav` itself: every command in these suites needs it.
 */
export function makePollRepo(): TempRepo {
  const repo = makeNavRepo();
  const plain = repo.nav.bind(repo);
  repo.nav = (args, env, input) => plain(args, { NAVBOOK_PLUGIN_PATH: PLUGIN, ...env }, input);
  repo.write(
    ".navbook/navbook.json",
    `${JSON.stringify({ version: 1, plugins: { "@navbook/plugin-poll": {} } }, null, 2)}\n`,
  );
  repo.commitAll("docs: declare plugin-poll");
  return repo;
}

/** The environment that makes `nav` act as somebody else: git's identity, overridden. */
export function as(name: string, email: string, now?: string): NodeJS.ProcessEnv {
  return {
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "user.name",
    GIT_CONFIG_VALUE_0: name,
    GIT_CONFIG_KEY_1: "user.email",
    GIT_CONFIG_VALUE_1: email,
    ...(now === undefined ? {} : { NAV_NOW: now }),
  };
}

/** The poll the suites ask: a single-choice question with a write-in, and a multiple-choice one. */
export const DRAFT = `---
title: Attachment storage
questions:
  - id: backend
    text: Which storage backend?
    other: true
    options:
      - { id: s3, label: S3-compatible, description: Cheap and durable. }
      - { id: disk, label: Local disk }
  - id: limits
    text: Which limits do we enforce?
    multi: true
    options:
      - { id: size, label: Max file size }
      - { id: count, label: Max files per issue }
---

Where do we keep attachments?
`;

/** Open an issue and commit it; its ID. */
export function openIssue(repo: TempRepo, title = "Attachments", env?: NodeJS.ProcessEnv): string {
  const result = repo.nav(
    ["issue", "open", title, "-m", "Issues need attachments.", "--commit"],
    env,
  );
  if (result.code !== 0) throw new Error(`nav issue open failed: ${result.stderr}`);
  return (result.stdout.match(/\(#([a-z0-9]{8})\)/) as RegExpMatchArray)[1] as string;
}

/** Open the suites' poll on an issue from stdin, and commit it; its ID. */
export function openPoll(repo: TempRepo, issue: string, draft = DRAFT): string {
  const result = repo.nav(["poll", "open", issue, "--from", "-", "--commit"], undefined, draft);
  if (result.code !== 0) throw new Error(`nav poll open failed: ${result.stderr}`);
  return (result.stdout.match(/^Opened poll ([a-z0-9]{8}) /) as RegExpMatchArray)[1] as string;
}

/** A file in the repository, by its path from the root. */
export function read(repo: TempRepo, path: string): string {
  return readFileSync(join(repo.dir, ...path.split("/")), "utf8");
}

/** The Markdown files in a directory of the repository, sorted. */
export function markdownIn(repo: TempRepo, dir: string): string[] {
  return readdirSync(join(repo.dir, ...dir.split("/")))
    .filter((name) => name.endsWith(".md"))
    .sort();
}

/** The last commit's whole message. */
export function lastMessage(repo: TempRepo): string {
  return repo.git(["log", "-1", "--format=%B"]).stdout.trim();
}

/** A poll's `show --json`, parsed. */
export function shown(
  repo: TempRepo,
  poll: string,
  env?: NodeJS.ProcessEnv,
): Record<string, unknown> {
  const result = repo.nav(["poll", "show", poll, "--json"], env);
  if (result.code !== 0) throw new Error(`nav poll show failed: ${result.stderr}`);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}
