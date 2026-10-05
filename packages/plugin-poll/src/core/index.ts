/**
 * Polls on issues: the format half — `doc/spec.md`.
 *
 * Registers where the data lives (`poll/` inside every issue's directory), the
 * `poll:` and `poll-awaiting:` query terms, and the three checks. Everything a
 * front end does with polls is exported from here too, since the CLI and the
 * API share it.
 */

import type { CorePluginHost, Repo } from "@navbook/core";
import { POLL_DIR, runningCore, SCOPE, useCore } from "./files.ts";
import {
  allPolls,
  awaits,
  buildIssuePolls,
  type PollReader,
  pollsOf,
  readsIssuePath,
} from "./tree.ts";

/** A diagnostic in the shape a registered check returns. */
type Found = { check: string; level: "error" | "warning"; path: string; message: string };

/** What `poll:` takes (§6.2), and `none` for an issue with no poll. */
export const POLL_STATES = ["open", "closed", "none"] as const;

export function activate(host: CorePluginHost): void {
  const { core } = host;
  // Before anything else: the format helpers take the running core from here.
  useCore(core);
  const reader: PollReader = { parse: (text) => core.parseFile(text), hash: core.blobSha };

  host.register({
    entityLocations: [
      {
        dir: POLL_DIR,
        kinds: ["issue"],
        reads: readsIssuePath,
        build: (files, entity, paths) => buildIssuePolls(files, entity, paths, reader),
      },
    ],
    queryKeys: [
      {
        key: "poll",
        kinds: ["issue"],
        parse: (value) => {
          const word = value.toLowerCase();
          return (POLL_STATES as readonly string[]).includes(word)
            ? word
            : {
                message: `'poll:${value}' is not a poll state; expected one of ${POLL_STATES.join(", ")}`,
              };
        },
        // An issue can hold polls in both states, so repeating the term ORs:
        // `poll:open poll:none` is "nothing decided yet".
        matches: (values, entity) => {
          const polls = pollsOf(entity);
          return values.some((value) =>
            value === "none" ? polls.length === 0 : polls.some((poll) => poll.status === value),
          );
        },
      },
      {
        key: "poll-awaiting",
        kinds: ["issue"],
        // Whether somebody has a hand in an issue reads its comments.
        needsComments: true,
        parse: (value) => {
          const person = core.parsePerson(value);
          return person === null
            ? { message: `'poll-awaiting:${value}' needs an email address` }
            : person.email.toLowerCase();
        },
        matches: (values, entity) =>
          values.some((person) => pollsOf(entity).some((poll) => awaits(entity, poll, person))),
      },
    ],
    doctorChecks: [
      { id: "X-poll-1", level: "error", run: (repo) => layoutAndSchema(repo) },
      { id: "X-poll-2", level: "warning", run: (repo) => lateVotes(repo) },
      { id: "X-poll-3", level: "error", run: (repo) => idCollisions(repo) },
    ],
    commitScopes: [SCOPE],
  });
}

/** X-poll-1: the layout of every issue's `poll/`, and every poll's and vote's own faults. */
function layoutAndSchema(repo: Repo): Found[] {
  const out: Found[] = (repo.extProblems.get(POLL_DIR) ?? []).map((problem) => ({
    check: "X-poll-1",
    level: "error",
    path: problem.path,
    message: problem.message,
  }));
  const report = (path: string, messages: readonly { message: string }[]): void => {
    for (const { message } of messages)
      out.push({ check: "X-poll-1", level: "error", path, message });
  };
  for (const poll of allPolls(repo)) {
    report(poll.filePath, poll.problems);
    for (const vote of poll.votes) report(vote.path, vote.problems);
  }
  return out;
}

/** X-poll-2: votes cast after their poll was closed, which take no part (§6.1). */
function lateVotes(repo: Repo): Found[] {
  return allPolls(repo).flatMap((poll) =>
    poll.ballots
      .filter((reading) => reading.state === "late")
      .map((reading) => ({
        check: "X-poll-2",
        level: "warning" as const,
        path: reading.vote.path,
        message: `this vote was cast at ${reading.vote.cast}, after poll ${poll.id} was closed at ${poll.closed}; it is not counted`,
      })),
  );
}

/** X-poll-3: a poll or vote ID that is also another's, an entity's or a comment's. */
function idCollisions(repo: Repo): Found[] {
  const owners = new Map<string, string>();
  for (const { id, path } of runningCore().allIds(repo)) if (!owners.has(id)) owners.set(id, path);
  const out: Found[] = [];
  const claim = (id: string, path: string): void => {
    const other = owners.get(id);
    if (other === undefined) {
      owners.set(id, path);
      return;
    }
    out.push({
      check: "X-poll-3",
      level: "error",
      path,
      message: `the ID ${id} is also ${other}'s; IDs must be unique across the repository`,
    });
  };
  for (const poll of allPolls(repo)) {
    claim(poll.id, poll.dirPath);
    for (const vote of poll.votes) claim(vote.id, vote.path);
  }
  return out;
}

export * from "./ballot.ts";
export * from "./files.ts";
export * from "./json.ts";
export * from "./ops.ts";
export * from "./tree.ts";
