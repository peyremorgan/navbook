/**
 * `nav poll vote` — by flags, and question by question at a terminal (driven
 * here from a pipe with `--interactive`).
 */

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { TempRepo } from "@navbook/cli/test-helpers";
import {
  as,
  DRAFT,
  lastMessage,
  makePollRepo,
  markdownIn,
  openIssue,
  openPoll,
  read,
  shown,
} from "./helpers.ts";

/** Bob, at a minute past eleven plus `n`: each vote of his a minute after the last. */
const bob = (n: number) =>
  as("Bob", "bob@example.com", `2026-08-01T11:${String(n).padStart(2, "0")}:00Z`);

describe("nav poll vote, by flags", () => {
  let repo: TempRepo;
  let issue: string;
  let poll: string;
  let dir: string;
  before(() => {
    repo = makePollRepo();
    issue = openIssue(repo);
    poll = openPoll(repo, issue);
    dir = (shown(repo, poll).path as string).slice(0);
  });
  after(() => repo.cleanup());
  const ballot = (env: NodeJS.ProcessEnv) =>
    (shown(repo, poll, env).me as Record<string, unknown>).ballot as Record<string, unknown> | null;

  it("casts a ballot by IDs or numbers, with a note", () => {
    const result = repo.nav(
      [
        "poll",
        "vote",
        poll,
        "--pick",
        "1=1",
        "--pick",
        "limits=size,2",
        "-m",
        "Cheap.",
        "--commit",
      ],
      bob(1),
    );
    assert.equal(result.code, 0, result.stderr);
    const [file] = markdownIn(repo, dir).filter((name) => name !== "poll.md");
    assert.equal(result.stdout.split("\n")[0], `Voted on poll ${poll}  ${dir}/${file}`);
    const vote = /-([a-z0-9]{8})\.md$/.exec(file as string)?.[1];
    assert.match(
      lastMessage(repo),
      new RegExp(`^docs\\(poll\\): vote ${poll} ${vote} on #${issue}\n\nRefs: ${issue}$`),
    );
    assert.match(read(repo, `${dir}/${file}`), /^author: Bob <bob@example\.com>\n/m);
    assert.deepEqual(ballot(bob(1))?.answers, {
      backend: { picks: ["s3"], other: null },
      limits: { picks: ["size", "count"], other: null },
    });
    assert.equal(ballot(bob(1))?.note, "Cheap.");
  });

  it("starts from the last ballot: a new pick keeps the other answers and the note", () => {
    assert.equal(
      repo.nav(["poll", "vote", poll, "--pick", "limits=count", "--commit"], bob(2)).code,
      0,
    );
    assert.deepEqual(ballot(bob(2))?.answers, {
      backend: { picks: ["s3"], other: null },
      limits: { picks: ["count"], other: null },
    });
    assert.equal(ballot(bob(2))?.note, "Cheap.");
  });

  it("puts a write-in in place of a single-choice pick, and clears a question", () => {
    const result = repo.nav(
      [
        "poll",
        "vote",
        poll,
        "--other",
        "backend=MinIO on our box",
        "--clear",
        "2",
        "-m",
        "Changed my mind.",
        "--commit",
      ],
      bob(3),
    );
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(ballot(bob(3))?.answers, {
      backend: { picks: [], other: "MinIO on our box" },
    });
    assert.equal(ballot(bob(3))?.note, "Changed my mind.");
    assert.equal(shown(repo, poll).voters, 1);
  });

  it("refuses what does not fit, naming the questions or options there are", () => {
    const fails = (args: string[], pattern: RegExp) => {
      const result = repo.nav(["poll", "vote", poll, ...args], bob(4));
      assert.equal(result.code, 1, args.join(" "));
      assert.match(result.stderr, pattern, args.join(" "));
    };
    fails(
      ["--pick", "backend=s3", "--other", "backend=x"],
      /question 'backend' takes one answer: --pick or --other, not both/,
    );
    fails(["--other", "limits=x"], /question 'limits' does not accept an answer in other words/);
    fails(
      ["--pick", "nope=1"],
      /'nope' is not a question of this poll\n {2}1 {2}backend {2}Which storage backend\?/,
    );
    fails(
      ["--pick", "backend=3"],
      /'3' is not an option of question 'backend'\n {2}1 {2}s3 {2}S3-compatible/,
    );
    fails(
      ["--pick", "backend="],
      /--pick backend= names no option; use --clear backend to skip it/,
    );
    fails(["--pick", "backend"], /--pick takes QUESTION=…, got 'backend'/);
    fails(["--other", "backend=  "], /--other backend= is empty; use --clear backend to skip it/);
    fails(["--withdraw", "--pick", "backend=s3"], /--withdraw answers nothing/);
    fails(["--fresh"], /this ballot answers no question/);
    fails([], /nothing to vote: pass --pick or --other, or run at a terminal to be asked/);
    fails(
      ["--other", "backend=MinIO on our box"],
      new RegExp(`your vote on poll ${poll} already says exactly this`),
    );
  });

  it("withdraws, and then has nothing left to withdraw", () => {
    const result = repo.nav(["poll", "vote", poll, "--withdraw", "--commit"], bob(5));
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`^Withdrew your vote on poll ${poll}`));
    assert.match(lastMessage(repo), new RegExp(`^docs\\(poll\\): withdraw ${poll} `));
    assert.equal((shown(repo, poll, bob(5)).me as Record<string, unknown>).state, "withdrawn");
    assert.equal(shown(repo, poll).voters, 0);
    const again = repo.nav(["poll", "vote", poll, "--withdraw"], bob(6));
    assert.equal(again.code, 1);
    assert.match(again.stderr, /you have no vote on poll .* to withdraw/);
  });
});

describe("nav poll vote, question by question", () => {
  let repo: TempRepo;
  let poll: string;
  let dir: string;
  before(() => {
    repo = makePollRepo();
    poll = openPoll(repo, openIssue(repo));
    dir = shown(repo, poll).path as string;
  });
  beforeEach(() => {
    repo.git(["checkout", "-q", "--", "."]);
  });
  after(() => repo.cleanup());
  const walk = (input: string, n: number) =>
    repo.nav(["poll", "vote", poll, "--interactive", "--commit"], bob(n), input);

  it("asks each question, says what was wrong and asks again, then asks once to cast it", () => {
    const result = walk(
      ["2", "1,o:also this", "size count", "Disks are simple.", "y", ""].join("\n"),
      1,
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /^Attachment storage {2}\(/);
    assert.match(
      result.stdout,
      /1\/2 Which storage backend\? {2}\(one answer, or in other words\)\n {3}1\. S3-compatible\n {6}Cheap and durable\.\n {3}2\. Local disk\n {3}o:<text> answers in your own words\n/,
    );
    assert.match(result.stdout, /nav: this question takes no answer in other words/);
    assert.match(
      result.stdout,
      /Your ballot:\n {2}1\. Which storage backend\? {2}→ Local disk\n {2}2\. Which limits do we enforce\? {2}→ Max file size, Max files per issue\n {2}note: Disks are simple\./,
    );
    assert.match(result.stdout, /Voted on poll /);
    const me = shown(repo, poll, bob(1)).me as { ballot: { answers: unknown; note: string } };
    assert.deepEqual(me.ballot.answers, {
      backend: { picks: ["disk"], other: null },
      limits: { picks: ["size", "count"], other: null },
    });
    assert.equal(me.ballot.note, "Disks are simple.");
  });

  it("keeps the last answers on Enter, skips on '-', and records nothing on a no", () => {
    const before_ = markdownIn(repo, dir);
    const declined = walk(["", "-", "", "n", ""].join("\n"), 2);
    assert.equal(declined.code, 0, declined.stderr);
    assert.match(declined.stdout, /Answer \(Enter keeps Local disk, '-' skips\)/);
    assert.match(
      declined.stdout,
      /Your ballot:\n {2}1\. Which storage backend\? {2}→ Local disk\n {2}2\. Which limits do we enforce\? {2}→ skipped/,
    );
    assert.match(declined.stdout, /Nothing was recorded\.\n$/);
    assert.deepEqual(markdownIn(repo, dir), before_);
  });

  it("records nothing when the input ends halfway", () => {
    const cut = walk("1\n", 3);
    assert.equal(cut.code, 1);
    assert.match(cut.stderr, /no answer; nothing was recorded/);
  });

  it("fills in what still fits once the questions changed under a ballot", () => {
    const edited = repo.nav(
      ["poll", "edit", poll, "--from", "-", "--commit"],
      undefined,
      DRAFT.replace("Max file size", "Max attachment size"),
    );
    assert.equal(edited.code, 0, edited.stderr);
    const result = walk(["", "", "", "y", ""].join("\n"), 4);
    assert.equal(result.code, 0, result.stderr);
    assert.match(
      result.stdout,
      /the questions changed since you voted; vote again; your last answers are filled in where they still fit/,
    );
    const me = shown(repo, poll, bob(4)).me as { state: string; ballot: { answers: unknown } };
    assert.equal(me.state, "counted");
    assert.deepEqual(me.ballot.answers, {
      backend: { picks: ["disk"], other: null },
      limits: { picks: ["size", "count"], other: null },
    });
  });
});
