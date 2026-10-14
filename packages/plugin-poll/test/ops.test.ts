/**
 * Polls changed through the operations both front ends call — `doc/spec.md`
 * §3, §4 and §9 — against a real repository.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import * as core from "@navbook/core";
import { validateRepo, type WsCtx } from "@navbook/core";
import { type Answer, newVoteFile, type PollDraft } from "../src/core/files.ts";
import {
  castVote,
  closePoll,
  editPoll,
  findPoll,
  loadTree,
  openPoll,
  parseDraft,
  reopenPoll,
  resolvePoll,
  takenIds,
} from "../src/core/ops.ts";
import { allPolls, type PollRecord, stateOf } from "../src/core/tree.ts";
import { extensions } from "./fixtures.ts";

const ext = extensions();

const git = (dir: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();

/** Somebody acting at a given time; minutes after ten on the 4th. */
type Act = (minute: number, who?: string) => WsCtx;

/** A throwaway repository with a Navbook tree and one open issue. */
function inRepo(use: (act: Act, dir: string, issueId: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "navbook-poll-ops-"));
  try {
    git(dir, "init", "--quiet", "-b", "main");
    git(dir, "config", "user.name", "Nav Test");
    git(dir, "config", "user.email", "nav@test.invalid");
    git(dir, "config", "commit.gpgsign", "false");
    writeFileSync(join(dir, "app.txt"), "v1\n");
    git(dir, "add", "app.txt");
    git(dir, "commit", "-qm", "seed");
    const act: Act = (minute, who) =>
      core.makeWsCtx({
        cwd: dir,
        env: { NAV_NOW: `2026-10-04T10:${String(minute).padStart(2, "0")}:00Z` },
        ext,
        ...(who === undefined ? {} : { identity: core.parsePerson(who) as core.Identity }),
      });
    core.initWorkspace(act(0), { commit: true });
    const content = core.newIssueFile({
      title: "Attachments",
      author: "Ivy <ivy@example.com>",
      created: "2026-10-04T10:00:00Z",
      body: "Issues need attachments.",
    });
    const opened = core.openEntity(
      act(0),
      "issue",
      { content, fallbackTitle: "Attachments" },
      { commit: true },
    );
    use(act, dir, opened.id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const DRAFT = `---
title: Attachment storage
questions:
  - text: Which storage backend?
    other: true
    options:
      - label: S3-compatible
        description: Cheap and durable.
      - label: Local disk
  - id: limits
    text: Which limits do we enforce?
    multi: true
    options:
      - { id: size, label: Max file size }
      - { id: count, label: Max files per issue }
---

Where do we keep attachments?
`;

const lastMessage = (dir: string): string => git(dir, "log", "-1", "--format=%B");
const issueOf = (ws: WsCtx, id: string) => core.findEntity(ws, "issue", id);
const pollOf = (ws: WsCtx, id: string): PollRecord => findPoll(core, ws, id);
const answers = (entries: Record<string, Partial<Answer>>) =>
  new Map(
    Object.entries(entries).map(([q, a]) => [q, { picks: a.picks ?? [], other: a.other ?? null }]),
  );
/** A refusal's code, message and details, or "not refused". */
const refusalWithDetails = (run: () => unknown): string[] => {
  try {
    run();
  } catch (error) {
    if (error instanceof core.WorkspaceError)
      return [`${error.code}: ${error.message}`, ...error.details];
    throw error;
  }
  return ["not refused"];
};
const refusal = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof core.WorkspaceError) return `${error.code}: ${error.message}`;
    throw error;
  }
  return "not refused";
};

/** Open the draft poll on the issue and commit it; its ID. */
function opened(act: Act, issueId: string, draft: PollDraft = parseDraft(core, DRAFT)): string {
  const ws = act(1);
  return openPoll(core, ws, issueOf(ws, issueId), draft, { commit: true }).id;
}

describe("opening a poll", () => {
  it("writes poll.md in the issue's directory, its IDs filled in, in one commit", () => {
    inRepo((act, dir, issueId) => {
      const ws = act(1);
      const issue = issueOf(ws, issueId);
      const result = openPoll(core, ws, issue, parseDraft(core, DRAFT), { commit: true });
      assert.equal(result.dirPath, `${issue.dirPath}/poll/${result.id}-attachment-storage`);
      assert.equal(
        lastMessage(dir),
        `docs(poll): open ${result.id} on #${issueId}\n\nRefs: ${issueId}`,
      );
      const text = readFileSync(join(dir, ".navbook", result.filePath), "utf8");
      assert.equal(
        text,
        [
          "---",
          "title: Attachment storage",
          "author: Nav Test <nav@test.invalid>",
          "created: 2026-10-04T10:01:00Z",
          "results: hidden",
          "questions:",
          "  - id: q1",
          "    text: Which storage backend?",
          "    other: true",
          "    options:",
          "      - id: s3-compatible",
          "        label: S3-compatible",
          "        description: Cheap and durable.",
          "      - id: local-disk",
          "        label: Local disk",
          "  - id: limits",
          "    text: Which limits do we enforce?",
          "    multi: true",
          "    options:",
          "      - id: size",
          "        label: Max file size",
          "      - id: count",
          "        label: Max files per issue",
          "---",
          "",
          "Where do we keep attachments?",
          "",
        ].join("\n"),
      );
      const poll = pollOf(ws, result.id);
      assert.deepEqual(poll.problems, []);
      assert.equal(poll.status, "open");
      assert.deepEqual(
        validateRepo(loadTree(core, ws), { ext }).filter((d) => d.level === "error"),
        [],
      );
    });
  });

  it("refuses a closed issue, and a draft that would not be a valid poll", () => {
    inRepo((act, _dir, issueId) => {
      const ws = act(1);
      assert.match(
        refusal(() =>
          parseDraft(
            core,
            DRAFT.replace("      - label: Local disk\n", "").replace("    other: true\n", ""),
          ),
        ),
        /^invalid-input: the poll is not valid: questions\[1\]: a question must offer at least two choices/,
      );
      assert.match(
        refusal(() => parseDraft(core, "no frontmatter")),
        /^invalid-input: /,
      );
      assert.match(
        refusal(() =>
          parseDraft(core, DRAFT.replace("---\n\n", "closed: 2026-10-04T10:00:00Z\n---\n\n")),
        ),
        /'closed' is written by closing a poll/,
      );
      const api: PollDraft = {
        title: "Bad",
        preamble: "",
        results: null,
        deadline: null,
        questions: [{ id: "Not An ID", text: "Q?", options: [{ label: "A" }, { label: "B" }] }],
      };
      assert.match(
        refusal(() => openPoll(core, ws, issueOf(ws, issueId), api, {})),
        /is not an ID/,
      );
      core.closeEntity(ws, "issue", issueId, { resolution: "fixed" }, { commit: true });
      assert.equal(
        refusal(() => openPoll(core, ws, issueOf(ws, issueId), parseDraft(core, DRAFT), {})),
        `precondition: #${issueId} is closed; reopen it to ask anything in it`,
      );
    });
  });
});

describe("voting", () => {
  it("writes a ballot beside the poll, and a later one replaces it", () => {
    inRepo((act, dir, issueId) => {
      const id = opened(act, issueId);
      const bob = act(2, "Bob <bob@example.com>");
      const first = castVote(
        core,
        bob,
        pollOf(bob, id),
        {
          answers: answers({
            q1: { picks: ["s3-compatible"] },
            limits: { picks: ["size", "count"] },
          }),
          note: "Cheap.",
        },
        { commit: true },
      );
      assert.equal(
        lastMessage(dir),
        `docs(poll): vote ${id} ${first.id} on #${issueId}\n\nRefs: ${issueId}`,
      );
      const poll = pollOf(bob, id);
      assert.equal(first.path, `${poll.dirPath}/2026-10-04T100200Z-${first.id}.md`);
      assert.equal(
        readFileSync(join(dir, ".navbook", first.path), "utf8"),
        [
          "---",
          "author: Bob <bob@example.com>",
          `fingerprint: ${poll.fingerprint}`,
          "answers:",
          "  q1:",
          "    picks:",
          "      - s3-compatible",
          "  limits:",
          "    picks:",
          "      - size",
          "      - count",
          "---",
          "",
          "Cheap.",
          "",
        ].join("\n"),
      );
      const later = act(3, "bob@EXAMPLE.com");
      castVote(
        core,
        later,
        pollOf(later, id),
        { answers: answers({ q1: { other: "  MinIO  " } }) },
        { commit: true },
      );
      const after = pollOf(later, id);
      assert.deepEqual(
        after.ballots.map((b) => b.state),
        ["superseded", "counted"],
      );
      assert.deepEqual(after.tallies[0]?.others, [{ text: "MinIO", voter: "bob@EXAMPLE.com" }]);
      assert.equal(after.tallies[1]?.answered, 0, "the skipped question is not answered");
    });
  });

  it("refuses answers that do not fit the questions", () => {
    inRepo((act, _dir, issueId) => {
      const id = opened(act, issueId);
      const ws = act(2);
      const vote = (entries: Record<string, Partial<Answer>>) =>
        refusal(() => castVote(core, ws, pollOf(ws, id), { answers: answers(entries) }, {}));
      assert.equal(
        vote({ nope: { picks: ["x"] } }),
        "invalid-input: 'nope' is not a question of this poll",
      );
      assert.equal(
        vote({ q1: { picks: ["s3-compatible", "local-disk"] } }),
        "invalid-input: question 'q1' takes one answer: one option, or one answer in other words",
      );
      assert.equal(
        vote({ q1: { picks: ["s3-compatible"], other: "x" } }),
        "invalid-input: question 'q1' takes one answer: one option, or one answer in other words",
      );
      assert.equal(
        vote({ limits: { other: "x" } }),
        "invalid-input: question 'limits' does not accept an answer in other words",
      );
      assert.equal(
        vote({ limits: { picks: ["size", "size"] } }),
        "invalid-input: 'size' is picked twice",
      );
      assert.equal(
        vote({ q1: { other: "two\nlines" } }),
        "invalid-input: the answer in other words to question 'q1' must be on one line",
      );
      assert.equal(
        vote({ limits: { picks: ["huge"] } }),
        "invalid-input: 'huge' is not an option of question 'limits'",
      );
      assert.equal(
        vote({ q1: { other: "   " } }),
        `precondition: you have no vote on poll ${id} to withdraw; answer at least one question to vote`,
      );
    });
  });

  it("withdraws, refuses to withdraw nothing, and refuses a ballot that says what the last one did", () => {
    inRepo((act, dir, issueId) => {
      const id = opened(act, issueId);
      const ws = act(2, "bob@example.com");
      const ballot = { answers: answers({ q1: { picks: ["local-disk"] } }), note: "Simple." };
      assert.match(
        refusal(() => castVote(core, ws, pollOf(ws, id), { answers: new Map() }, {})),
        /no vote on poll .* to withdraw/,
      );
      castVote(core, ws, pollOf(ws, id), ballot, { commit: true });
      const again = act(3, "bob@example.com");
      assert.equal(
        refusal(() => castVote(core, again, pollOf(again, id), ballot, {})),
        `precondition: your vote on poll ${id} already says exactly this`,
      );
      castVote(
        core,
        again,
        pollOf(again, id),
        { ...ballot, note: "Simple, really." },
        { commit: true },
      );
      const out = act(4, "bob@example.com");
      const withdrawn = castVote(
        core,
        out,
        pollOf(out, id),
        { answers: new Map() },
        { commit: true },
      );
      assert.equal(withdrawn.withdrawn, true);
      assert.match(
        lastMessage(dir),
        new RegExp(`^docs\\(poll\\): withdraw ${id} ${withdrawn.id} on #${issueId}`),
      );
      assert.equal(stateOf(pollOf(out, id), "bob@example.com"), "withdrawn");
      const twice = act(5, "bob@example.com");
      assert.match(
        refusal(() => castVote(core, twice, pollOf(twice, id), { answers: new Map() }, {})),
        /to withdraw/,
      );
    });
  });

  it("stamps a second vote cast in the same second after the first, so it is the one that counts", () => {
    inRepo((act, _dir, issueId) => {
      const id = opened(act, issueId);
      const vote = (picks: string[]) => {
        const ws = act(2, "bob@example.com");
        return castVote(
          core,
          ws,
          pollOf(ws, id),
          { answers: answers({ q1: { picks } }) },
          { commit: true },
        );
      };
      const first = vote(["s3-compatible"]);
      const second = vote(["local-disk"]);
      assert.match(first.path, /2026-10-04T100200Z-/);
      assert.match(second.path, /2026-10-04T100201Z-/);
      const ws = act(2, "bob@example.com");
      const out = castVote(core, ws, pollOf(ws, id), { answers: new Map() }, { commit: true });
      assert.match(out.path, /2026-10-04T100202Z-/);
      const poll = pollOf(ws, id);
      assert.deepEqual(
        poll.ballots.map((b) => b.state),
        ["superseded", "superseded", "withdrawn"],
      );
    });
  });

  it("closes a poll no earlier than its latest vote, so a quick revote is not late", () => {
    inRepo((act, _dir, issueId) => {
      const id = opened(act, issueId);
      for (const picks of [["s3-compatible"], ["local-disk"], ["s3-compatible"]]) {
        const ws = act(2, "bob@example.com");
        castVote(
          core,
          ws,
          pollOf(ws, id),
          { answers: answers({ q1: { picks } }) },
          { commit: true },
        );
      }
      const ws = act(2);
      closePoll(core, ws, pollOf(ws, id), {}, { commit: true });
      const poll = pollOf(ws, id);
      assert.equal(poll.closed, "2026-10-04T10:02:02Z");
      assert.deepEqual(
        poll.ballots.map((b) => b.state),
        ["superseded", "superseded", "counted"],
      );
      assert.deepEqual(Object.fromEntries(poll.outcome ?? []), {
        q1: { picks: ["s3-compatible"], other: null },
      });
    });
  });

  it("neither stamps after nor closes at a vote stamped far ahead of the clock", () => {
    inRepo((act, dir, issueId) => {
      const id = opened(act, issueId);
      const bob = act(2, "bob@example.com");
      castVote(
        core,
        bob,
        pollOf(bob, id),
        { answers: answers({ q1: { picks: ["s3-compatible"] } }) },
        { commit: true },
      );
      // By hand: a vote of Bob's from 2099; one of Dan's four minutes ahead of
      // the clock, which a fast clock explains; and one of Eve's, which has
      // faults and counts for nothing.
      const poll = pollOf(bob, id);
      const ballot = (author: string, picks: string[]) =>
        newVoteFile({
          author,
          fingerprint: poll.fingerprint,
          answers: answers({ q1: { picks } }),
          note: "",
        });
      const files: Record<string, string> = {
        "2099-01-01T000000Z-zzzz9999.md": ballot("bob@example.com", ["s3-compatible"]),
        "2026-10-04T100700Z-dddd4444.md": ballot("dan@example.com", ["local-disk"]),
        "2026-10-04T100730Z-eeee5555.md": ballot("eve@example.com", ["nope"]),
      };
      for (const [name, content] of Object.entries(files))
        writeFileSync(join(dir, ".navbook", poll.dirPath, name), content);
      git(dir, "add", ".navbook");
      git(dir, "commit", "-qm", "docs: votes by hand");

      const again = act(3, "bob@example.com");
      const recast = castVote(
        core,
        again,
        pollOf(again, id),
        { answers: answers({ q1: { picks: ["local-disk"] } }) },
        { commit: true },
      );
      assert.match(recast.path, /2026-10-04T100300Z-/);

      const ws = act(3);
      closePoll(core, ws, pollOf(ws, id), { decide: new Map([["q1", null]]) }, { commit: true });
      const closed = pollOf(ws, id);
      assert.equal(closed.closed, "2026-10-04T10:07:00Z");
      assert.deepEqual(
        closed.ballots.map((b) => `${b.vote.author} ${b.vote.cast} ${b.state}`),
        [
          "bob@example.com 2026-10-04T10:02:00Z superseded",
          "bob@example.com 2026-10-04T10:03:00Z counted",
          "dan@example.com 2026-10-04T10:07:00Z counted",
          "bob@example.com 2099-01-01T00:00:00Z late",
        ],
      );
    });
  });

  it("mints IDs no poll or vote holds, those of archived issues included", () => {
    inRepo((act, dir, issueId) => {
      const archived = join(
        dir,
        ".navbook/archive/2025/issues/closed/q1w2e3r4-old/poll/e5f6g7h8-x",
      );
      execFileSync("mkdir", ["-p", archived]);
      writeFileSync(
        join(dir, ".navbook/archive/2025/issues/closed/q1w2e3r4-old/issue.md"),
        "---\ntitle: Old\nauthor: a@example.com\ncreated: 2025-01-01T00:00:00Z\nresolution: fixed\n---\n\nOld.\n",
      );
      writeFileSync(
        join(archived, "poll.md"),
        readFileSync(join(dir, ".navbook", pollOf(act(1), opened(act, issueId)).filePath), "utf8"),
      );
      writeFileSync(
        join(archived, "2025-01-02T000000Z-v9v9v9v9.md"),
        "---\nauthor: a@example.com\nfingerprint: 0123456789abcdef\nanswers: {}\n---\n",
      );
      const taken = takenIds(core, act(2));
      assert.ok(
        core.scanAllIds(join(dir, ".navbook")).has("e5f6g7h8"),
        "the scan sees the poll's directory",
      );
      assert.ok(
        !core.scanAllIds(join(dir, ".navbook")).has("v9v9v9v9"),
        "but not the vote beneath it",
      );
      assert.ok(taken.has("e5f6g7h8") && taken.has("v9v9v9v9") && taken.has(issueId));
    });
  });

  it("refuses a form whose questions changed under it", () => {
    inRepo((act, _dir, issueId) => {
      const id = opened(act, issueId);
      const ws = act(2);
      assert.equal(
        refusal(() =>
          castVote(
            core,
            ws,
            pollOf(ws, id),
            { answers: answers({ q1: { picks: ["local-disk"] } }) },
            { fingerprint: "0123456789abcdef" },
          ),
        ),
        `stale-content: the questions of poll ${id} changed since you opened it`,
      );
    });
  });
});

describe("limits (§4.2)", () => {
  const options = (count: number) =>
    Array.from({ length: count }, (_, o) => ({ label: `Option ${o + 1}` }));
  const draft = (questions: PollDraft["questions"]): PollDraft => ({
    title: "Big",
    preamble: "",
    results: null,
    deadline: null,
    questions,
  });

  it("refuses to open or edit a poll over them, before making anything of it", () => {
    inRepo((act, _dir, issueId) => {
      const ws = act(1);
      const open = (questions: PollDraft["questions"]) =>
        refusal(() => openPoll(core, ws, issueOf(ws, issueId), draft(questions), {}));
      assert.equal(
        open([{ text: "Wide?", options: options(101) }]),
        "invalid-input: the poll is not valid: questions[1]: the number of options must be at most 100, got 101",
      );
      assert.equal(
        open(Array.from({ length: 51 }, () => ({ text: "Again?", options: options(2) }))),
        "invalid-input: the poll is not valid: the number of questions must be at most 50, got 51",
      );
      assert.equal(
        open([{ text: "Long?", options: [{ label: "x".repeat(201) }, { label: "y" }] }]),
        "invalid-input: the poll is not valid: questions[1].options[1]: 'label' must be at most 200 characters",
      );
      assert.equal(
        refusal(() =>
          openPoll(
            core,
            ws,
            issueOf(ws, issueId),
            { ...draft([{ text: "Q?", options: options(2) }]), preamble: "p".repeat(20001) },
            {},
          ),
        ),
        "invalid-input: the poll is not valid: the preamble must be at most 20000 characters",
      );
      const id = opened(act, issueId);
      const edit = act(2);
      assert.equal(
        refusal(() =>
          editPoll(
            core,
            edit,
            pollOf(edit, id),
            { questions: [{ text: "Wide?", options: options(1000) }] },
            {},
          ),
        ),
        "invalid-input: the poll is not valid: questions[1]: the number of options must be at most 100, got 1000",
      );
    });
  });

  it("refuses a ballot or a closing over them, listing a few faults and counting the rest", () => {
    inRepo((act, _dir, issueId) => {
      const id = opened(act, issueId);
      const ws = act(2);
      const unknown = new Map(
        Array.from({ length: 20000 }, (_, q): [string, Answer] => [
          `x${q}`,
          { picks: ["a"], other: null },
        ]),
      );
      const refused = refusalWithDetails(() =>
        castVote(core, ws, pollOf(ws, id), { answers: unknown }, {}),
      );
      assert.equal(refused[0], "invalid-input: 'x0' is not a question of this poll");
      assert.equal(refused.length, 22, "the message, twenty details, and a count");
      assert.equal(refused[20], "'x20' is not a question of this poll");
      assert.equal(refused[21], "and 19979 more");
      assert.equal(
        refusal(() =>
          castVote(
            core,
            ws,
            pollOf(ws, id),
            { answers: answers({ q1: { other: "w".repeat(501) } }) },
            {},
          ),
        ),
        "invalid-input: the answer in other words to question 'q1' must be at most 500 characters",
      );
      assert.equal(
        refusal(() =>
          castVote(
            core,
            ws,
            pollOf(ws, id),
            { answers: answers({ q1: { picks: ["local-disk"] } }), note: "n".repeat(10001) },
            {},
          ),
        ),
        "invalid-input: the note must be at most 10000 characters",
      );
      assert.equal(
        refusal(() => closePoll(core, ws, pollOf(ws, id), { note: "n".repeat(10001) }, {})),
        "invalid-input: the note must be at most 10000 characters",
      );
    });
  });
});

describe("editing", () => {
  it("leaves the questions as they are when only the title changes, and revokes nothing", () => {
    inRepo((act, dir, issueId) => {
      const id = opened(act, issueId);
      const bob = act(2, "bob@example.com");
      castVote(
        core,
        bob,
        pollOf(bob, id),
        { answers: answers({ q1: { picks: ["local-disk"] } }) },
        { commit: true },
      );
      const ws = act(3);
      const before = pollOf(ws, id);
      const beforeText = readFileSync(join(dir, ".navbook", before.filePath), "utf8");
      const edited = editPoll(
        core,
        ws,
        before,
        { title: "Where attachments live" },
        { commit: true, baseSha: before.blobSha },
      );
      assert.equal(edited.revoked, 0);
      assert.equal(lastMessage(dir), `docs(poll): edit ${id} on #${issueId}\n\nRefs: ${issueId}`);
      const afterText = readFileSync(join(dir, ".navbook", before.filePath), "utf8");
      assert.equal(
        afterText,
        beforeText.replace("title: Attachment storage", "title: Where attachments live"),
      );
      assert.equal(pollOf(ws, id).voters, 1);
    });
  });

  it("revokes every ballot when the questions change, and asks again of whoever cast one", () => {
    inRepo((act, _dir, issueId) => {
      const id = opened(act, issueId);
      for (const [minute, who] of [
        [2, "bob@example.com"],
        [3, "ann@example.com"],
      ] as const) {
        const ws = act(minute, who);
        castVote(
          core,
          ws,
          pollOf(ws, id),
          { answers: answers({ limits: { picks: ["size"] } }) },
          { commit: true },
        );
      }
      const ws = act(4);
      const draft = parseDraft(core, DRAFT.replace("Max file size", "Max attachment size"));
      const edited = editPoll(core, ws, pollOf(ws, id), draft, { commit: true });
      assert.equal(edited.revoked, 2);
      const after = pollOf(ws, id);
      assert.equal(after.voters, 0);
      assert.equal(stateOf(after, "ann@example.com"), "revoked");
      assert.equal(
        refusal(() => editPoll(core, ws, after, { title: "x" }, { baseSha: "0".repeat(40) })),
        `stale-content: poll ${id} changed since you opened it`,
      );
      assert.match(
        refusal(() => editPoll(core, ws, after, { questions: [] }, {})),
        /'questions' must be a list of at least one question/,
      );
      assert.equal(
        refusal(() => editPoll(core, ws, after, { title: after.title }, {})),
        `precondition: that changes nothing in poll ${id}`,
      );
    });
  });
});

describe("closing and reopening", () => {
  it("refuses to break a tie for the closer, and records what they decided", () => {
    inRepo((act, dir, issueId) => {
      const id = opened(act, issueId);
      for (const [minute, who, pick] of [
        [2, "bob@example.com", "s3-compatible"],
        [3, "ann@example.com", "local-disk"],
      ] as const) {
        const ws = act(minute, who);
        castVote(
          core,
          ws,
          pollOf(ws, id),
          { answers: answers({ q1: { picks: [pick] }, limits: { picks: ["size"] } }) },
          { commit: true },
        );
      }
      const ws = act(4, "Ada <ada@example.com>");
      assert.equal(
        refusal(() => closePoll(core, ws, pollOf(ws, id), {}, {})),
        `precondition: poll ${id} has a tie only you can break: decide it, or leave it undecided`,
      );
      assert.equal(
        refusal(() =>
          closePoll(
            core,
            ws,
            pollOf(ws, id),
            { decide: new Map([["q1", { picks: ["nope"], other: null }]]) },
            {},
          ),
        ),
        "invalid-input: 'nope' is not an option of question 'q1'",
      );
      const closed = closePoll(
        core,
        ws,
        pollOf(ws, id),
        {
          decide: new Map([["q1", { picks: ["local-disk"], other: null }]]),
          note: "Ops prefer disks.\n\nFor now.",
        },
        { commit: true },
      );
      assert.deepEqual(Object.fromEntries(closed.decision), {
        q1: { picks: ["local-disk"], other: null },
        limits: { picks: ["size"], other: null },
      });
      assert.equal(lastMessage(dir), `docs(poll): close ${id} on #${issueId}\n\nRefs: ${issueId}`);
      const poll = pollOf(ws, id);
      assert.deepEqual(poll.problems, []);
      assert.equal(poll.status, "closed");
      assert.equal(poll.closed, "2026-10-04T10:04:00Z");
      assert.equal(poll.closedBy, "Ada <ada@example.com>");
      assert.equal(poll.decisionNote, "Ops prefer disks.\n\nFor now.");
      assert.match(
        refusal(() => closePoll(core, ws, poll, {}, {})),
        /is already closed/,
      );
      const late = act(5, "cy@example.com");
      assert.equal(
        refusal(() =>
          castVote(
            core,
            late,
            pollOf(late, id),
            { answers: answers({ q1: { picks: ["s3-compatible"] } }) },
            {},
          ),
        ),
        `precondition: poll ${id} is closed; reopen it to vote`,
      );
      assert.match(
        refusal(() => editPoll(core, late, pollOf(late, id), { title: "x" }, {})),
        /is closed; reopen it to edit it/,
      );
    });
  });

  it("leaves a question undecided when asked to, and reopens to an open poll with no decision", () => {
    inRepo((act, dir, issueId) => {
      const id = opened(act, issueId);
      const ws = act(2);
      closePoll(core, ws, pollOf(ws, id), { decide: new Map([["q1", null]]) }, { commit: true });
      const poll = pollOf(ws, id);
      assert.equal(poll.outcome?.size, 0, "nobody voted: nothing to decide");
      const text = readFileSync(join(dir, ".navbook", poll.filePath), "utf8");
      assert.doesNotMatch(text, /^decision:/m);
      assert.equal(reopenPoll(core, ws, poll, { commit: true }).late, 0);
      assert.equal(lastMessage(dir), `docs(poll): reopen ${id} on #${issueId}\n\nRefs: ${issueId}`);
      const reopened = pollOf(ws, id);
      assert.equal(reopened.status, "open");
      assert.equal(reopened.closed, null);
      assert.doesNotMatch(readFileSync(join(dir, ".navbook", poll.filePath), "utf8"), /closed/);
      assert.match(
        refusal(() => reopenPoll(core, ws, reopened, {})),
        /is not closed/,
      );
    });
  });

  it("reads a poll whose issue closed as closed, and will not reopen it before the issue", () => {
    inRepo((act, _dir, issueId) => {
      const id = opened(act, issueId);
      const ws = act(2);
      core.closeEntity(ws, "issue", issueId, { resolution: "fixed" }, { commit: true });
      const poll = pollOf(ws, id);
      assert.equal(poll.closedByIssue, true);
      assert.match(
        refusal(() => reopenPoll(core, ws, poll, {})),
        /closed only because #.* is; reopen the issue/,
      );
      assert.match(
        refusal(() =>
          castVote(core, ws, poll, { answers: answers({ q1: { picks: ["local-disk"] } }) }, {}),
        ),
        /is closed with its issue #.*; reopen the issue to vote/,
      );
      closePoll(core, ws, poll, {}, { commit: true });
      const recorded = pollOf(ws, id);
      assert.equal(recorded.closedByIssue, false);
      assert.match(
        refusal(() => reopenPoll(core, ws, recorded, {})),
        /is closed; reopen it before its poll/,
      );
    });
  });
});

describe("reopening a poll with votes cast while it was closed", () => {
  it("counts them again, and says how many", () => {
    inRepo((act, dir, issueId) => {
      const id = opened(act, issueId);
      const bob = act(2, "bob@example.com");
      castVote(
        core,
        bob,
        pollOf(bob, id),
        { answers: answers({ q1: { picks: ["s3-compatible"] } }) },
        { commit: true },
      );
      const ws = act(3);
      closePoll(core, ws, pollOf(ws, id), {}, { commit: true });
      // A vote a race left behind: cast on another clone after the close.
      const poll = pollOf(ws, id);
      writeFileSync(
        join(dir, ".navbook", poll.dirPath, "2026-10-04T100500Z-l8l8l8l8.md"),
        `---\nauthor: bob@example.com\nfingerprint: ${poll.fingerprint}\nanswers:\n  q1: { picks: [local-disk] }\n---\n`,
      );
      assert.deepEqual(
        pollOf(ws, id).ballots.map((b) => b.state),
        ["counted", "late"],
      );
      const reopened = reopenPoll(core, act(6), pollOf(ws, id), {});
      assert.equal(reopened.late, 1);
      assert.deepEqual(
        pollOf(ws, id).ballots.map((b) => b.state),
        ["superseded", "counted"],
      );
    });
  });
});

describe("finding a poll", () => {
  it("takes an ID, a prefix, a directory name or a path", () => {
    inRepo((act, _dir, issueId) => {
      const id = opened(act, issueId);
      const ws = act(2);
      const polls = allPolls(loadTree(core, ws));
      const poll = polls[0] as PollRecord;
      for (const ref of [
        id,
        id.slice(0, 4),
        `#${id}`,
        poll.dirName,
        `.navbook/${poll.dirPath}/`,
        `.navbook/${poll.filePath}`,
      ]) {
        assert.equal(resolvePoll(core, polls, ref).id, id, ref);
      }
      assert.match(
        refusal(() => resolvePoll(core, polls, id.slice(0, 3))),
        /^prefix-too-short/,
      );
      assert.match(
        refusal(() => resolvePoll(core, polls, "zzzz9999")),
        /^not-found: no poll matches/,
      );
      assert.match(
        refusal(() =>
          resolvePoll(core, [...polls, { ...poll, id: `${id.slice(0, 4)}zzzz` }], id.slice(0, 4)),
        ),
        /^ambiguous/,
      );
    });
  });
});
