/**
 * Polls and votes read out of a tree — `doc/spec.md` §2 to §8.
 *
 * Everything here runs over an in-memory tree, the way the scan of another
 * branch does: what the plugin concludes about a poll must not depend on
 * whether the files came from a checkout, the index or somebody else's branch.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as core from "@navbook/core";
import {
  isQueryError,
  matchesQuery,
  type NavTree,
  parseQuery,
  parseTree,
  validateRepo,
} from "@navbook/core";
import { prefill } from "../src/core/ballot.ts";
import {
  canonicalJson,
  completeQuestions,
  fingerprint,
  newVoteFile,
  readPoll,
  readVote,
} from "../src/core/files.ts";
import { pollJson } from "../src/core/json.ts";
import { allPolls, awaits, type PollRecord, pollsOf, stateOf } from "../src/core/tree.ts";
import {
  answers,
  CURRENT,
  extensions,
  fingerprintOf,
  ISSUE_DIR,
  ISSUE_ID,
  issue,
  POLL_DIR,
  POLL_ID,
  poll,
  QUESTIONS,
  SPEC_VECTOR,
  vote,
  votePath,
} from "./fixtures.ts";

const ext = extensions();
const tree = (entries: Record<string, string>): NavTree => new Map(Object.entries(entries));
const read = (entries: Record<string, string>) => parseTree(tree(entries), { ext });
const base = (extra: Record<string, string> = {}, pollText = poll()) => ({
  [`${ISSUE_DIR}/issue.md`]: issue(),
  [`${POLL_DIR}/poll.md`]: pollText,
  ...extra,
});
/** The only poll of a tree built from `base`. */
const only = (entries: Record<string, string>): PollRecord => {
  const polls = allPolls(read(entries));
  assert.equal(polls.length, 1, "one poll");
  return polls[0] as PollRecord;
};
const layout = (entries: Record<string, string>): string[] =>
  (read(entries).extProblems.get("poll") ?? []).map((p) => `${p.path}: ${p.message}`);
const checks = (entries: Record<string, string>): string[] =>
  validateRepo(read(entries), { ext })
    .filter((d) => d.check.startsWith("X-poll"))
    .map((d) => `${d.check} ${d.path}: ${d.message}`);

const T1 = "2026-10-04T101500Z";
const T2 = "2026-10-04T111500Z";
const T3 = "2026-10-04T121500Z";
const T4 = "2026-10-04T131500Z";

describe("reading poll/", () => {
  it("reads a poll, its questions and its votes, routed away from the issue's extra files", () => {
    const repo = read(
      base({
        [votePath(T1, "v7q2w8e4")]: vote({ note: "We run S3 already." }),
        [`${POLL_DIR}/notes.txt`]: "kept",
        [`${POLL_DIR}/attachments/diagram.png`]: "\u0089PNG",
      }),
    );
    assert.deepEqual(repo.extProblems.get("poll") ?? [], []);
    const [only_] = repo.issues;
    assert.deepEqual(only_?.extraFiles, []);
    const polls = pollsOf(only_ as core.EntityRecord);
    assert.equal(polls.length, 1);
    const p = polls[0] as PollRecord;
    assert.equal(p.id, POLL_ID);
    assert.equal(p.slug, "attachment-storage");
    assert.equal(p.title, "Attachment storage");
    assert.equal(p.preamble, "Where do we keep attachments?");
    assert.equal(p.results, "hidden");
    assert.equal(p.status, "open");
    assert.equal(p.closedByIssue, false);
    assert.equal(p.outcome, null);
    assert.deepEqual(p.problems, []);
    assert.deepEqual(p.extraFiles, [
      `${POLL_DIR}/attachments/diagram.png`,
      `${POLL_DIR}/notes.txt`,
    ]);
    assert.deepEqual(
      p.questions.map((q) => [q.id, q.multi, q.other, q.options.map((o) => o.id)]),
      [
        ["backend", false, true, ["s3", "disk"]],
        ["limits", true, false, ["size", "count"]],
      ],
    );
    assert.equal(
      p.questions[0]?.options[0]?.description,
      "Cheap and durable; the server needs credentials in its environment.",
    );
    assert.equal(p.questions[0]?.options[1]?.description, null);
    const [v] = p.votes;
    assert.equal(v?.id, "v7q2w8e4");
    assert.equal(v?.cast, "2026-10-04T10:15:00Z");
    assert.equal(v?.note, "We run S3 already.");
    assert.deepEqual(v?.problems, []);
    assert.equal(p.voters, 1);
    assert.deepEqual(repo.reserved, []);
  });

  it("reports what does not fit the layout, and keeps what it does not interpret", () => {
    const problems = layout(
      base({
        [`${ISSUE_DIR}/poll/stray.md`]: "x",
        [`${ISSUE_DIR}/poll/Not-A-Poll/poll.md`]: poll(),
        [`${ISSUE_DIR}/poll/abcdefg1-empty/notes.txt`]: "no poll.md",
        [`${POLL_DIR}/notes.md`]: "not a vote",
        [`${POLL_DIR}/2026-10-04T1015Z-v7q2w8e4.md`]: vote(),
      }),
    );
    assert.deepEqual(problems, [
      `${ISSUE_DIR}/poll/Not-A-Poll: poll directory name 'Not-A-Poll' does not match <id>-<slug>`,
      `${POLL_DIR}/2026-10-04T1015Z-v7q2w8e4.md: '2026-10-04T1015Z-v7q2w8e4.md' is not a vote: a vote is named <timestamp>-<id>.md, and only poll.md and votes may be Markdown here`,
      `${POLL_DIR}/notes.md: 'notes.md' is not a vote: a vote is named <timestamp>-<id>.md, and only poll.md and votes may be Markdown here`,
      `${ISSUE_DIR}/poll/stray.md: 'poll/' must contain poll directories, not files`,
      `${ISSUE_DIR}/poll/abcdefg1-empty: poll directory is missing its poll.md`,
    ]);
  });

  it("reads the polls of closed and archived issues, and leaves a pull request's poll/ alone", () => {
    const closed = "issues/closed/m2n4b6v8-done";
    const archived = "archive/2025/issues/closed/q1w2e3r4-old";
    const pr = "prs/open/z9x8c7v6-change";
    const repo = read({
      [`${closed}/issue.md`]: `${issue().replace("---\n\n", "resolution: fixed\n---\n\n")}`,
      [`${closed}/poll/a1b2c3d4-x/poll.md`]: poll(),
      [`${archived}/issue.md`]: issue(),
      [`${archived}/poll/e5f6g7h8-y/poll.md`]: poll(),
      [`${pr}/pr.md`]: [
        "---",
        "title: Change",
        "author: ked@example.com",
        "created: 2026-09-21T08:00:00Z",
        "target: main",
        "source: feat/x",
        "---",
        "",
        "Change.",
        "",
      ].join("\n"),
      [`${pr}/poll/i9j8k7l6-z/poll.md`]: poll(),
    });
    assert.deepEqual(
      allPolls(repo).map((p) => [p.id, p.status, p.closedByIssue]),
      [
        ["a1b2c3d4", "closed", true],
        ["e5f6g7h8", "closed", true],
      ],
    );
    assert.deepEqual(repo.prs[0]?.extraFiles, [`${pr}/poll/i9j8k7l6-z/poll.md`]);
  });
});

describe("poll.md", () => {
  const faults = (text: string): string[] => only(base({}, text)).problems.map((p) => p.message);

  it("accepts the spec's example", () => {
    assert.deepEqual(faults(poll()), []);
  });

  it("requires a one-line title, an author, a creation time and questions", () => {
    assert.deepEqual(faults(poll({ title: null })), ["missing required key 'title'"]);
    assert.deepEqual(faults(poll({ title: '"Two\\nlines"' })), ["'title' must be on one line"]);
    assert.deepEqual(faults(poll({ questions: "" })), ["missing required key 'questions'"]);
    assert.deepEqual(faults(poll({ questions: "questions: []" })), [
      "'questions' must be a list of at least one question",
    ]);
  });

  it("names every fault of a question and an option, by position", () => {
    const text = poll({
      questions: [
        "questions:",
        "  - id: Bad ID",
        "    text: ''",
        "    multi: 'yes'",
        "    max: 2",
        "    options:",
        "      - { id: a, label: A, colour: red }",
        "      - { id: a, label: Again }",
        "      - { label: 'Two\\nlines' }",
        "  - id: two",
        "    text: One option and no write-in",
        "    options:",
        "      - { id: only, label: Only }",
        "  - id: two",
        "    text: A repeated ID",
        "    options: []",
        "  - just a string",
      ].join("\n"),
    }).replace("label: 'Two\\nlines'", 'label: "Two\\nlines"');
    assert.deepEqual(faults(text), [
      "questions[1]: 'max' is not a key of a question",
      'questions[1].id: "Bad ID" is not an ID: lowercase letters, digits and single hyphens',
      "questions[1]: 'text' must be a non-empty string",
      'questions[1].multi: must be true or false, got "yes"',
      "questions[1].options[1]: 'colour' is not a key of an option",
      "questions[1].options[2].id: 'a' is the ID of an earlier option of this question",
      "questions[1].options[3]: missing required key 'id'",
      "questions[1].options[3]: 'label' must be on one line",
      "questions[2]: a question must offer at least two choices: two options, or one and 'other: true'",
      "questions[3].id: 'two' is the ID of an earlier question",
      "questions[3]: 'options' must be a list of at least one option",
      "questions[4]: a question must be a map",
    ]);
  });

  it("accepts one option with a write-in, and reads YAML-looking scalars as the text written", () => {
    const text = poll({
      questions: [
        "questions:",
        "  - id: 42",
        "    text: yes",
        "    other: true",
        "    options:",
        "      - { id: 1, label: 1.10 }",
        "      - { id: '2', label: true }",
      ].join("\n"),
    });
    assert.deepEqual(faults(text), []);
    const [q] = only(base({}, text)).questions;
    assert.equal(q?.id, "42");
    assert.equal(q?.text, "yes");
    assert.deepEqual(
      q?.options.map((o) => [o.id, o.label]),
      [
        ["1", "1.10"],
        ["2", "true"],
      ],
    );
  });

  it("checks results, deadline and the closing keys", () => {
    assert.deepEqual(faults(poll({ raw: "results: secret\ndeadline: 2026-10-10T10:00:00Z" })), [
      "'results' must be hidden or visible, got \"secret\"",
      "'deadline' must be a calendar date as YYYY-MM-DD, got \"2026-10-10T10:00:00Z\"",
    ]);
    assert.deepEqual(faults(poll({ raw: "closed: 2026-10-05T10:00:00Z" })), [
      "a closed poll must say who closed it: 'closed-by'",
    ]);
    assert.deepEqual(
      faults(poll({ raw: "closed-by: a@example.com\ndecision: {}\ndecision-note: why" })),
      [
        "'closed-by' without 'closed': the poll is not closed",
        "'decision' without 'closed': only a closed poll has a decision",
        "'decision-note' without 'closed': only a closed poll has a decision",
      ],
    );
    assert.deepEqual(faults(poll({ raw: "status: open" })).length, 1);
  });

  it("checks a decision against the questions, as it would a ballot", () => {
    const closed = (decision: string) =>
      faults(poll({ closed: "2026-10-05T10:00:00Z", raw: `decision:\n${decision}` }));
    assert.deepEqual(closed("  backend: { picks: [s3] }\n  limits: { picks: [size, count] }"), []);
    assert.deepEqual(closed("  backend: { picks: [], other: MinIO }"), []);
    assert.deepEqual(closed("  backend: { picks: [s3, disk] }"), [
      "decision: question 'backend' takes one answer: one option, or one answer in other words",
    ]);
    assert.deepEqual(closed("  nope: { picks: [x] }\n  limits: { picks: [huge], other: x }"), [
      "decision: 'nope' is not a question of this poll",
      "decision: 'huge' is not an option of question 'limits'",
      "decision: question 'limits' does not accept an answer in other words",
    ]);
  });
});

describe("the fingerprint (§5)", () => {
  it("is the spec's vector for the spec's example", () => {
    assert.equal(CURRENT, SPEC_VECTOR);
  });

  it("is canonical JSON: sorted keys, no whitespace", () => {
    assert.equal(
      canonicalJson({ b: [true, "x"], a: { d: false, c: "é\n" } }),
      '{"a":{"c":"é\\n","d":false},"b":[true,"x"]}',
    );
    assert.throws(() => canonicalJson({ n: 1 }), /no canonical JSON for number/);
  });

  it("does not see formatting: key order, flow style, explicit defaults, a block's last line break", () => {
    const same = [
      "questions:",
      "  - text: Which storage backend?",
      "    options:",
      "      - label: S3-compatible",
      "        id: s3",
      '        description: "Cheap and durable; the server needs credentials in its environment."',
      "      - { label: Local disk, id: disk }",
      "    id: backend",
      "    multi: false",
      "    other: true",
      "  - { id: limits, text: Which limits do we enforce?, multi: true, other: false, options: [{ id: size, label: Max file size }, { id: count, label: Max files per issue, description: '  ' }] }",
    ].join("\n");
    assert.equal(fingerprintOf(poll({ questions: same })), SPEC_VECTOR);
  });

  it("sees every change to the questions, and none to the rest", () => {
    const changed = (from: string, to: string) =>
      fingerprintOf(poll({ questions: QUESTIONS.replace(from, to) }));
    assert.notEqual(changed("Local disk", "Local disks"), SPEC_VECTOR);
    assert.notEqual(changed("multi: true", "multi: false"), SPEC_VECTOR);
    assert.notEqual(changed("environment.", "environment!"), SPEC_VECTOR);
    assert.notEqual(changed("id: disk", "id: disc"), SPEC_VECTOR);
    const swapped = QUESTIONS.replace(
      "      - { id: size, label: Max file size }\n      - { id: count, label: Max files per issue }",
      "      - { id: count, label: Max files per issue }\n      - { id: size, label: Max file size }",
    );
    assert.notEqual(fingerprintOf(poll({ questions: swapped })), SPEC_VECTOR);
    assert.equal(
      fingerprintOf(
        poll({
          title: "Renamed",
          preamble: "Other words",
          raw: "results: visible\ndeadline: 2026-12-01",
        }),
      ),
      SPEC_VECTOR,
    );
  });

  it("is the same for a draft's questions once their IDs are filled in", () => {
    const filled = completeQuestions([
      {
        id: "backend",
        text: " Which storage backend? ",
        other: true,
        options: [
          {
            id: "s3",
            label: "S3-compatible",
            description: "Cheap and durable; the server needs credentials in its environment.\n",
          },
          { label: "Local disk" },
        ],
      },
      {
        id: "limits",
        text: "Which limits do we enforce?",
        multi: true,
        options: [
          { id: "size", label: "Max file size" },
          { id: "count", label: "Max files per issue" },
        ],
      },
    ]);
    assert.equal(filled[0]?.options[1]?.id, "local-disk");
    assert.notEqual(fingerprint(filled), SPEC_VECTOR, "a derived ID is still an ID");
    assert.equal(
      fingerprint(completeQuestions(readPoll(core.parseFile(poll())).questions)),
      SPEC_VECTOR,
    );
  });
});

describe("filling in IDs", () => {
  it("numbers questions, slugs labels, and never collides with an ID that was given", () => {
    const filled = completeQuestions([
      {
        text: "First?",
        options: [
          { label: "Ünïcödé Ünït" },
          { label: "日本語" },
          { label: "Ünïcödé ünït!" },
          { id: "o2", label: "Given" },
        ],
      },
      { id: "q1", text: "Given q1", options: [{ label: "A" }, { label: "B" }] },
      { text: "Third?", options: [{ label: `${"long ".repeat(10)}end` }, { label: "x" }] },
    ]);
    assert.deepEqual(
      filled.map((q) => [q.id, q.options.map((o) => o.id)]),
      [
        ["q1-2", ["unicode-unit", "o2-2", "unicode-unit-2", "o2"]],
        ["q1", ["a", "b"]],
        ["q3", ["long-long-long-long-long-long-lo", "x"]],
      ],
    );
  });
});

describe("votes", () => {
  const faultsOf = (text: string, pollText = poll()): string[] =>
    only(base({ [votePath(T1, "v7q2w8e4")]: text }, pollText)).votes[0]?.problems.map(
      (p) => p.message,
    ) ?? [];

  it("accepts a ballot, a write-in, a skipped question, and a withdrawal", () => {
    assert.deepEqual(faultsOf(vote()), []);
    assert.deepEqual(
      faultsOf(vote({ answers: answers("  backend: { picks: [], other: MinIO }") })),
      [],
    );
    assert.deepEqual(faultsOf(vote({ answers: answers("  limits: { picks: [size], }") })), []);
    assert.deepEqual(faultsOf(vote({ answers: "answers: {}" })), []);
  });

  it("names what is wrong with the file whatever the poll says", () => {
    assert.deepEqual(faultsOf(vote({ fingerprint: null, answers: "" })), [
      "missing required key 'fingerprint'",
      "missing required key 'answers'; '{}' withdraws a vote",
    ]);
    assert.deepEqual(
      faultsOf(
        vote({
          fingerprint: "ABC",
          answers: answers(
            "  Backend: { picks: [s3] }",
            "  limits: { picks: size }",
            "  backend: { picks: [s3, s3], other: '  ', extra: 1 }",
          ),
        }),
      ),
      [
        "'fingerprint' must be 16 lowercase hexadecimal digits, got \"ABC\"",
        "answers: 'Backend' is not a question ID",
        "answers.limits: 'picks' must be a list of option IDs",
        "answers.backend: 'extra' is not a key of an answer",
        "answers.backend: 's3' is picked twice",
        "answers.backend: 'other' must be a non-empty string",
      ],
    );
    assert.deepEqual(faultsOf(vote({ answers: answers("  backend: { picks: [] }") })), [
      "answers.backend: an answer must pick an option or write one in; leave a question out to skip it",
    ]);
    assert.deepEqual(faultsOf(vote({ answers: "answers: [s3]" })), [
      "'answers' must be a map of answers by question ID",
    ]);
  });

  it("reads a fingerprint YAML would take for a number as the digits written, and writes it quoted", () => {
    for (const digits of ["1234567890123456", "1234e56789012345"]) {
      assert.deepEqual(faultsOf(vote({ fingerprint: digits })), [], digits);
      const p = only(base({ [votePath(T1, "v7q2w8e4")]: vote({ fingerprint: digits }) }));
      assert.equal(p.votes[0]?.fingerprint, digits);
      const written = newVoteFile({
        author: "a@example.com",
        fingerprint: digits,
        answers: new Map(),
        note: "",
      });
      assert.equal(readVote(core.parseFile(written)).fingerprint, digits);
      assert.match(written, new RegExp(`^fingerprint: "${digits}"$`, "m"));
    }
  });

  it("judges answers against the questions only when it answered these ones", () => {
    const wrong = answers(
      "  nope: { picks: [x] }",
      "  backend: { picks: [s3], other: MinIO }",
      "  limits: { picks: [huge] }",
    );
    assert.deepEqual(faultsOf(vote({ answers: wrong })), [
      "'nope' is not a question of this poll",
      "question 'backend' takes one answer: one option, or one answer in other words",
      "'huge' is not an option of question 'limits'",
    ]);
    assert.deepEqual(faultsOf(vote({ answers: wrong, fingerprint: "0123456789abcdef" })), []);
    const noOther = poll({ questions: QUESTIONS.replace("    other: true\n", "") });
    assert.deepEqual(
      faultsOf(
        vote({
          answers: answers("  backend: { picks: [], other: x }"),
          fingerprint: fingerprintOf(noOther),
        }),
        noOther,
      ),
      ["question 'backend' does not accept an answer in other words"],
    );
  });
});

describe("ballots (§6.1)", () => {
  const states = (entries: Record<string, string>, pollText?: string) =>
    only(base(entries, pollText)).ballots.map((b) => `${b.vote.id} ${b.state}`);

  it("counts each voter's latest vote, their address compared without regard to case", () => {
    assert.deepEqual(
      states({
        [votePath(T1, "aaaa1111")]: vote({ author: "bob@example.com" }),
        [votePath(T2, "bbbb2222")]: vote({ author: "Ann <ann@example.com>" }),
        [votePath(T3, "cccc3333")]: vote({ author: "Bob Voter <BOB@Example.COM>" }),
      }),
      ["aaaa1111 superseded", "bbbb2222 counted", "cccc3333 counted"],
    );
  });

  it("orders two votes in one second by file name, which is to say by ID", () => {
    assert.deepEqual(
      states({
        [votePath(T1, "zzzz9999")]: vote(),
        [votePath(T1, "aaaa1111")]: vote({ answers: answers("  backend: { picks: [disk] }") }),
      }),
      ["aaaa1111 superseded", "zzzz9999 counted"],
    );
  });

  it("never brings back an older ballot: not past a withdrawal, nor a revoked one", () => {
    assert.deepEqual(
      states({
        [votePath(T1, "aaaa1111")]: vote(),
        [votePath(T2, "bbbb2222")]: vote({ answers: "answers: {}" }),
      }),
      ["aaaa1111 superseded", "bbbb2222 withdrawn"],
    );
    const p = only(
      base({
        [votePath(T1, "aaaa1111")]: vote(),
        [votePath(T2, "bbbb2222")]: vote({ fingerprint: "0123456789abcdef" }),
      }),
    );
    assert.deepEqual(
      p.ballots.map((b) => b.state),
      ["superseded", "revoked"],
    );
    assert.equal(p.voters, 0);
    assert.equal(stateOf(p, "bob@example.com"), "revoked");
  });

  it("calls a revoked ballot withdrawn once its voter withdraws it", () => {
    assert.deepEqual(
      states({
        [votePath(T1, "aaaa1111")]: vote({ fingerprint: "0123456789abcdef" }),
        [votePath(T2, "bbbb2222")]: vote({
          answers: "answers: {}",
          fingerprint: "0123456789abcdef",
        }),
      }),
      ["aaaa1111 superseded", "bbbb2222 withdrawn"],
    );
  });

  it("revokes every ballot when the questions change", () => {
    const entries = {
      [votePath(T1, "aaaa1111")]: vote(),
      [votePath(T2, "bbbb2222")]: vote({ author: "ann@example.com" }),
    };
    assert.equal(only(base(entries)).voters, 2);
    const edited = poll({ questions: QUESTIONS.replace("Local disk", "Local disk, mirrored") });
    assert.deepEqual(states(entries, edited), ["aaaa1111 revoked", "bbbb2222 revoked"]);
  });

  it("ignores a vote with faults, so the voter's earlier ballot still stands", () => {
    const p = only(
      base({
        [votePath(T1, "aaaa1111")]: vote(),
        [votePath(T2, "bbbb2222")]: vote({ answers: answers("  backend: { picks: [nope] }") }),
      }),
    );
    assert.deepEqual(
      p.ballots.map((b) => `${b.vote.id} ${b.state}`),
      ["aaaa1111 counted"],
    );
    assert.equal(p.votes.length, 2);
  });

  it("counts a vote cast in the second a poll closed, and not one cast after", () => {
    const closed = poll({ closed: "2026-10-04T11:15:00Z" });
    const p = only(
      base(
        {
          [votePath(T1, "aaaa1111")]: vote(),
          [votePath(T2, "bbbb2222")]: vote({ author: "ann@example.com" }),
          [votePath(T3, "cccc3333")]: vote({ answers: answers("  backend: { picks: [disk] }") }),
        },
        closed,
      ),
    );
    assert.deepEqual(
      p.ballots.map((b) => b.state),
      ["counted", "counted", "late"],
    );
    assert.equal(p.tallies[0]?.leaders.join(), "s3", "the late change of mind does not count");
    assert.equal(stateOf(p, "bob@example.com"), "counted");
  });

  it("reads a poll its issue closed as closed, with every vote counting and the tallies' decision", () => {
    const closedDir = ISSUE_DIR.replace("issues/open", "issues/closed");
    const p = only({
      [`${closedDir}/issue.md`]: issue(),
      [`${POLL_DIR.replace("issues/open", "issues/closed")}/poll.md`]: poll(),
      [votePath(T4, "aaaa1111", POLL_DIR.replace("issues/open", "issues/closed"))]: vote(),
    });
    assert.equal(p.status, "closed");
    assert.equal(p.closedByIssue, true);
    assert.equal(p.closed, null);
    assert.equal(p.voters, 1);
    assert.deepEqual(Object.fromEntries(p.outcome ?? []), {
      backend: { picks: ["s3"], other: null },
      limits: { picks: ["size"], other: null },
    });
  });

  it("starts a new ballot from the voter's last one, less whatever no longer fits", () => {
    const edited = poll({
      questions: QUESTIONS.replace("    other: true\n", "").replace(
        "{ id: size, label: Max file size }",
        "{ id: big, label: Max attachment size }",
      ),
    });
    const p = only(
      base(
        {
          [votePath(T1, "aaaa1111")]: vote({
            answers: answers(
              "  backend: { picks: [], other: MinIO }",
              "  limits: { picks: [size, count] }",
            ),
            note: "Because.",
          }),
        },
        edited,
      ),
    );
    assert.equal(stateOf(p, "bob@example.com"), "revoked");
    const start = prefill(p.questions, p.ballots, "Bob <bob@example.com>");
    assert.deepEqual(Object.fromEntries(start.answers), {
      limits: { picks: ["count"], other: null },
    });
    assert.equal(start.note, "Because.");
    assert.deepEqual(prefill(p.questions, p.ballots, "nobody@example.com"), {
      answers: new Map(),
      note: null,
    });
  });
});

describe("tallies and decisions (§6.3)", () => {
  it("counts picks and write-ins, names who, and finds the leaders", () => {
    const p = only(
      base({
        [votePath(T1, "aaaa1111")]: vote(),
        [votePath(T2, "bbbb2222")]: vote({
          author: "Ann <ann@example.com>",
          answers: answers(
            "  backend: { picks: [], other: MinIO }",
            "  limits: { picks: [size, count] }",
          ),
        }),
        [votePath(T3, "cccc3333")]: vote({
          author: "cy@example.com",
          answers: answers("  limits: { picks: [count] }"),
        }),
      }),
    );
    const [backend, limits] = p.tallies;
    assert.deepEqual(backend, {
      question: "backend",
      answered: 2,
      options: [
        { option: "s3", count: 1, voters: ["Bob Voter <bob@example.com>"] },
        { option: "disk", count: 0, voters: [] },
      ],
      others: [{ text: "MinIO", voter: "Ann <ann@example.com>" }],
      leaders: ["s3"],
      tied: false,
    });
    assert.deepEqual(limits?.leaders, ["size", "count"]);
    assert.equal(limits?.tied, false, "a multiple-choice question is never tied");
    assert.deepEqual(Object.fromEntries(p.proposed), {
      backend: { picks: ["s3"], other: null },
      limits: { picks: ["size", "count"], other: null },
    });
  });

  it("proposes nothing for a tie, or for a question nobody answered", () => {
    const p = only(
      base({
        [votePath(T1, "aaaa1111")]: vote({ answers: answers("  backend: { picks: [s3] }") }),
        [votePath(T2, "bbbb2222")]: vote({
          author: "ann@example.com",
          answers: answers("  backend: { picks: [disk] }"),
        }),
      }),
    );
    assert.equal(p.tallies[0]?.tied, true);
    assert.deepEqual(p.tallies[0]?.leaders, ["s3", "disk"]);
    assert.deepEqual(p.tallies[1]?.leaders, []);
    assert.equal(p.proposed.size, 0);
  });

  it("reads a recorded decision as the outcome, whatever the tallies say", () => {
    const p = only(
      base(
        { [votePath(T1, "aaaa1111")]: vote() },
        poll({
          closed: "2026-10-05T10:00:00Z",
          raw: "decision:\n  backend: { picks: [disk] }\ndecision-note: Ops said no.",
        }),
      ),
    );
    assert.deepEqual(Object.fromEntries(p.outcome ?? []), {
      backend: { picks: ["disk"], other: null },
    });
    assert.equal(p.decisionNote, "Ops said no.");
    assert.equal(p.closedBy, "Ada Assignee <ada@example.com>");
  });
});

describe("query terms", () => {
  /** Terms separated by `|`, so that one may hold a space. */
  const parse = (query: string) => parseQuery(query.split("|"), "issue", ext);
  const refused = (query: string): string => {
    const parsed = parse(query);
    return isQueryError(parsed) ? parsed.message : "accepted";
  };
  const match = (entries: Record<string, string>, query: string): string[] => {
    const repo = parseTree(tree(entries), { ext, commentsLoaded: "all" });
    const parsed = parse(query);
    if (isQueryError(parsed)) throw new Error(parsed.message);
    return repo.issues
      .filter((entity) => matchesQuery(parsed, entity, undefined, ext))
      .map((entity) => entity.id);
  };
  const other = "issues/open/n5m6b7v8-other";
  const entries = {
    ...base({ [votePath(T1, "aaaa1111")]: vote() }),
    [`${other}/issue.md`]: issue(),
  };

  it("poll: says whether an issue has a poll open, closed, or none", () => {
    assert.deepEqual(match(entries, "poll:open"), [ISSUE_ID]);
    assert.deepEqual(match(entries, "poll:none"), ["n5m6b7v8"]);
    assert.deepEqual(match(entries, "poll:closed"), []);
    assert.deepEqual(match(entries, "poll:closed|poll:none"), ["n5m6b7v8"]);
    assert.match(refused("poll:maybe"), /'poll:maybe' is not a poll state/);
  });

  it("poll-awaiting: finds the open polls somebody with a hand in the issue has not answered", () => {
    const commented = {
      ...entries,
      [`${ISSUE_DIR}/comments/2026-10-04T090000Z-c1c2c3c4.md`]:
        "---\nauthor: Cy <cy@example.com>\n---\n\nHm.\n",
    };
    assert.deepEqual(
      match(commented, "poll-awaiting:ivy@example.com"),
      [ISSUE_ID],
      "the issue's author",
    );
    assert.deepEqual(match(commented, "poll-awaiting:ADA@example.com"), [ISSUE_ID], "its assignee");
    assert.deepEqual(
      match(commented, "poll-awaiting:Cy <cy@example.com>"),
      [ISSUE_ID],
      "a commenter",
    );
    assert.deepEqual(
      match(commented, "poll-awaiting:zed@example.com"),
      [],
      "somebody with no hand in it",
    );
    assert.deepEqual(match(commented, "poll-awaiting:bob@example.com"), [], "somebody who voted");
    assert.match(refused("poll-awaiting:bob"), /needs an email address/);
  });

  it("poll-awaiting: asks again of whoever's ballot was revoked, and never of a closed poll", () => {
    const edited = poll({ questions: QUESTIONS.replace("Local disk", "Disk") });
    const repo = parseTree(tree({ ...entries, [`${POLL_DIR}/poll.md`]: edited }), {
      ext,
      commentsLoaded: "all",
    });
    const owner = repo.issues.find((i) => i.id === ISSUE_ID) as core.EntityRecord;
    const p = pollsOf(owner)[0] as PollRecord;
    assert.equal(awaits(owner, p, "bob@example.com"), true);
    const withdrawn = parseTree(
      tree({ ...entries, [votePath(T2, "bbbb2222")]: vote({ answers: "answers: {}" }) }),
      { ext, commentsLoaded: "all" },
    );
    const w = withdrawn.issues.find((i) => i.id === ISSUE_ID) as core.EntityRecord;
    assert.equal(
      awaits(w, pollsOf(w)[0] as PollRecord, "bob@example.com"),
      false,
      "a withdrawal is an answer",
    );
    const closed = {
      ...entries,
      [`${POLL_DIR}/poll.md`]: poll({ closed: "2026-10-05T10:00:00Z" }),
    };
    assert.deepEqual(match(closed, "poll-awaiting:ivy@example.com"), []);
    const faulty = { ...entries, [`${POLL_DIR}/poll.md`]: poll({ raw: "results: secret" }) };
    assert.deepEqual(
      match(faulty, "poll-awaiting:ivy@example.com"),
      [],
      "nobody can answer a poll whose file has faults",
    );
  });
});

describe("checks", () => {
  it("say nothing about a sound tree", () => {
    assert.deepEqual(checks(base({ [votePath(T1, "aaaa1111")]: vote() })), []);
  });

  it("X-poll-1 reports the layout and every poll's and vote's faults", () => {
    const found = checks(
      base(
        {
          [`${ISSUE_DIR}/poll/stray.md`]: "x",
          [votePath(T1, "aaaa1111")]: vote({ answers: answers("  backend: { picks: [nope] }") }),
        },
        poll({ title: null }),
      ),
    );
    assert.deepEqual(found, [
      `X-poll-1 ${votePath(T1, "aaaa1111")}: 'nope' is not an option of question 'backend'`,
      `X-poll-1 ${POLL_DIR}/poll.md: missing required key 'title'`,
      `X-poll-1 ${ISSUE_DIR}/poll/stray.md: 'poll/' must contain poll directories, not files`,
    ]);
  });

  it("X-poll-2 warns of a vote cast after the poll closed", () => {
    const found = checks(
      base({ [votePath(T3, "cccc3333")]: vote() }, poll({ closed: "2026-10-04T11:15:00Z" })),
    );
    assert.deepEqual(found, [
      `X-poll-2 ${votePath(T3, "cccc3333")}: this vote was cast at 2026-10-04T12:15:00Z, after poll ${POLL_ID} was closed at 2026-10-04T11:15:00Z; it is not counted`,
    ]);
  });

  it("X-poll-3 reports a poll or vote ID another file already has", () => {
    const found = checks(
      base({
        [`${ISSUE_DIR}/comments/2026-10-04T090000Z-${POLL_ID}.md`]:
          "---\nauthor: a@example.com\n---\n\nx\n",
        [votePath(T1, ISSUE_ID)]: vote(),
      }),
    );
    assert.deepEqual(found, [
      `X-poll-3 ${POLL_DIR}: the ID ${POLL_ID} is also ${ISSUE_DIR}/comments/2026-10-04T090000Z-${POLL_ID}.md's; IDs must be unique across the repository`,
      `X-poll-3 ${votePath(T1, ISSUE_ID)}: the ID ${ISSUE_ID} is also ${ISSUE_DIR}'s; IDs must be unique across the repository`,
    ]);
  });
});

describe("the JSON projection", () => {
  it("carries the tallies whatever results says, and where the person asking stands", () => {
    const p = only(base({ [votePath(T1, "aaaa1111")]: vote({ note: "S3!" }) }));
    const json = pollJson(".navbook", p, "bob@example.com") as Record<string, unknown>;
    assert.equal(json.id, POLL_ID);
    assert.equal(json.issue, ISSUE_ID);
    assert.equal(json.path, `.navbook/${POLL_DIR}`);
    assert.equal(json.results, "hidden");
    assert.equal(json.voters, 1);
    assert.equal((json.tallies as { answered: number }[])[0]?.answered, 1);
    assert.deepEqual(json.me, {
      voter: "bob@example.com",
      state: "counted",
      ballot: {
        id: "aaaa1111",
        path: `.navbook/${votePath(T1, "aaaa1111")}`,
        author: "Bob Voter <bob@example.com>",
        cast: "2026-10-04T10:15:00Z",
        fingerprint: CURRENT,
        state: "counted",
        answers: {
          backend: { picks: ["s3"], other: null },
          limits: { picks: ["size"], other: null },
        },
        note: "S3!",
      },
    });
    assert.equal("me" in pollJson(".navbook", p, null), false);
  });
});
