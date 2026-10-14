/**
 * Polls over the API — `doc/spec.md`, spec 06 §6.3.
 *
 * One server for the suite, as a deployment has, and three people: the one who
 * files the issue (the harness's default token), and two voters. The cases run
 * in order and build on each other, the way people using the web client would.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { blobSha } from "@navbook/core";
import {
  errorCode,
  type GraphQLResponse,
  type Harness,
  ok,
  originSubjects,
  startHarness,
} from "@navbook/server/test-helpers";

const ENV = { NAVBOOK_PLUGIN_PATH: join(dirname(fileURLToPath(import.meta.url)), "..") };

// biome-ignore lint/suspicious/noExplicitAny: test payloads are read positionally
type Payload = any;

const POLL_FIELDS = `id path baseSha title author created preamble results deadline fingerprint
  status closedByIssue closed closedBy decisionNote voters problems myState closingTies
  questions { id text multi other options { id label description } }
  outcome { question picks other }
  proposed { question picks other }
  tallies { question answered tied leaders options { option count voters } others { text voter } }
  votes { id author state answers { question picks other } note }
  myBallot { id state answers { question picks other } note }
  myDraft { answers { question picks other } note }
  issue { id }`;
const PAYLOAD = `poll { ${POLL_FIELDS} } issue { id ext } revoked late commit { committed subject pushed }`;
const OPEN = `mutation($input: OpenPollInput!) { openPoll(input: $input) { ${PAYLOAD} } }`;
const EDIT = `mutation($input: EditPollInput!) { editPoll(input: $input) { ${PAYLOAD} } }`;
const VOTE = `mutation($input: VotePollInput!) { votePoll(input: $input) { ${PAYLOAD} } }`;
const CLOSE = `mutation($input: ClosePollInput!) { closePoll(input: $input) { ${PAYLOAD} } }`;
const REOPEN = `mutation($input: ReopenPollInput!) { reopenPoll(input: $input) { ${PAYLOAD} } }`;
const POLL = `query($id: ID!) { poll(id: $id) { ${POLL_FIELDS} } }`;

const QUESTIONS = [
  {
    id: "backend",
    text: "Which storage backend?",
    other: true,
    options: [
      { id: "s3", label: "S3-compatible", description: "Cheap and durable." },
      { label: "Local disk" },
    ],
  },
  {
    text: "Which limits do we enforce?",
    multi: true,
    options: [{ id: "size", label: "Max file size" }, { label: "Max files per issue" }],
  },
];

describe("polls over the API", () => {
  let h: Harness;
  let served: string;
  let issue: string;
  let poll: string;
  let alice: string;
  let bob: string;

  before(async () => {
    h = await startHarness({ env: ENV, pullIntervalMs: 0 });
    served = h.fixture.server.dir;
    alice = await h.token({ name: "Alice", email: "alice@example.com" });
    bob = await h.token({ name: "Bob", email: "bob@example.com" });
    const opened = ok<Payload>(
      await h.gql(
        `mutation { openIssue(input: { title: "Attachments", body: "Issues need them." }) { issue { id } } }`,
      ),
    );
    issue = opened.openIssue.issue.id;
  });
  after(async () => {
    await h.stop();
  });

  const as = (token: string) => (query: string, variables?: Record<string, unknown>) =>
    h.gql(query, variables, token);
  const current = async (token?: string): Promise<Payload> =>
    ok<Payload>(await h.gql(POLL, { id: poll }, token)).poll;
  /**
   * Each voter's votes' states, in the order they cast them: one person's
   * votes sort as they were cast, two people's in the same second by ID.
   */
  const statesBy = (votes: Payload[]): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    for (const vote of votes) out[vote.author] = [...(out[vote.author] ?? []), vote.state];
    return out;
  };
  const refused = (response: GraphQLResponse<unknown>, code: string, pattern: RegExp): void => {
    assert.equal(errorCode(response), code, JSON.stringify(response.errors));
    assert.match(response.errors[0]?.message ?? "", pattern);
  };

  it("merges its schema: an issue has no polls yet", async () => {
    const data = ok<Payload>(await h.gql(`{ issue(ref: "${issue}") { polls { id } ext } }`));
    assert.deepEqual(data.issue.polls, []);
    assert.deepEqual(data.issue.ext.poll, { polls: [] });
  });

  it("opens a poll from fields, filling in the IDs left out", async () => {
    const data = ok<Payload>(
      await h.gql(OPEN, {
        input: {
          issue,
          title: "Attachment storage",
          preamble: "Where do we keep them?",
          questions: QUESTIONS,
        },
      }),
    );
    const opened = data.openPoll.poll;
    poll = opened.id;
    assert.deepEqual(
      opened.questions.map((q: Payload) => [
        q.id,
        q.multi,
        q.other,
        q.options.map((o: Payload) => o.id),
      ]),
      [
        ["backend", false, true, ["s3", "local-disk"]],
        ["q2", true, false, ["size", "max-files-per-issue"]],
      ],
    );
    assert.equal(opened.author, "A Person <person@example.invalid>");
    assert.equal(opened.results, "HIDDEN");
    assert.equal(opened.status, "OPEN");
    assert.equal(opened.myState, "NONE");
    assert.equal(opened.preamble, "Where do we keep them?");
    assert.equal(opened.issue.id, issue);
    assert.match(
      opened.path,
      new RegExp(`^\\.navbook/issues/open/${issue}-attachments/poll/${poll}-attachment-storage$`),
    );
    assert.deepEqual(data.openPoll.commit, {
      committed: true,
      subject: `docs(poll): open ${poll} on #${issue}`,
      pushed: true,
    });
    assert.equal(originSubjects(h.fixture.origin)[0], `docs(poll): open ${poll} on #${issue}`);
    assert.deepEqual(data.openPoll.issue.ext.poll.polls, [
      { id: poll, title: "Attachment storage", created: opened.created, status: "open", voters: 0 },
    ]);
    const text = readFileSync(join(served, opened.path, "poll.md"), "utf8");
    assert.equal(blobSha(text), opened.baseSha);
  });

  it("refuses a poll it could not write as one", async () => {
    refused(
      await h.gql(OPEN, { input: { issue, title: " ", questions: QUESTIONS } }),
      "INVALID_INPUT",
      /title/,
    );
    refused(
      await h.gql(OPEN, {
        input: { issue, title: "X", questions: [{ text: "Q?", options: [{ label: "Only" }] }] },
      }),
      "INVALID_INPUT",
      /at least two choices/,
    );
    refused(
      await h.gql(OPEN, {
        input: {
          issue,
          title: "X",
          questions: [{ id: "Bad ID", text: "Q?", options: [{ label: "A" }, { label: "B" }] }],
        },
      }),
      "INVALID_INPUT",
      /is not an ID/,
    );
    refused(
      await h.gql(OPEN, {
        input: { issue, title: "X", deadline: "next week", questions: QUESTIONS },
      }),
      "INVALID_INPUT",
      /calendar date/,
    );
    refused(
      await h.gql(OPEN, { input: { issue: "zzzz9999", title: "X", questions: QUESTIONS } }),
      "NOT_FOUND",
      /zzzz9999/,
    );
    // The limits of §4.2: twenty thousand options are refused before any of
    // them is made into a file.
    const wide = Array.from({ length: 20000 }, (_, o) => ({ label: `Option ${o}` }));
    refused(
      await h.gql(OPEN, {
        input: { issue, title: "X", questions: [{ text: "Q?", options: wide }] },
      }),
      "INVALID_INPUT",
      /the number of options must be at most 100, got 20000/,
    );
  });

  it("casts each person's ballot, and says where each stands", async () => {
    const before_ = await current();
    const voted = ok<Payload>(
      await as(alice)(VOTE, {
        input: {
          poll,
          fingerprint: before_.fingerprint,
          answers: [
            { question: "backend", picks: ["s3"] },
            { question: "q2", picks: ["size", "max-files-per-issue"] },
          ],
          note: "We run S3.",
        },
      }),
    ).votePoll;
    assert.match(
      voted.commit.subject,
      new RegExp(`^docs\\(poll\\): vote ${poll} [a-z0-9]{8} on #${issue}$`),
    );
    assert.equal(voted.poll.myState, "COUNTED");
    assert.equal(voted.poll.myBallot.note, "We run S3.");
    assert.equal(voted.poll.voters, 1);
    assert.equal(voted.issue.ext.poll.polls[0].voters, 1);
    ok(
      await as(bob)(VOTE, {
        input: {
          poll,
          fingerprint: before_.fingerprint,
          answers: [{ question: "backend", other: "  MinIO  " }],
        },
      }),
    );
    const mine = await current(alice);
    const theirs = await current(bob);
    const nobody = await current();
    assert.deepEqual(
      [mine.myState, theirs.myState, nobody.myState],
      ["COUNTED", "COUNTED", "NONE"],
    );
    assert.deepEqual(theirs.myBallot.answers, [{ question: "backend", picks: [], other: "MinIO" }]);
    assert.equal(nobody.myBallot, null);
    assert.deepEqual(nobody.tallies[0], {
      question: "backend",
      answered: 2,
      tied: false,
      leaders: ["s3"],
      options: [
        { option: "s3", count: 1, voters: ["Alice <alice@example.com>"] },
        { option: "local-disk", count: 0, voters: [] },
      ],
      others: [{ text: "MinIO", voter: "Bob <bob@example.com>" }],
    });
    assert.deepEqual(nobody.proposed, [
      { question: "backend", picks: ["s3"], other: null },
      { question: "q2", picks: ["size", "max-files-per-issue"], other: null },
    ]);
  });

  it("refuses a ballot that does not fit, or was built from other questions", async () => {
    const { fingerprint } = await current();
    const vote = (answers: Payload, fp = fingerprint) =>
      as(alice)(VOTE, { input: { poll, fingerprint: fp, answers, note: "We run S3." } });
    refused(
      await vote([{ question: "backend", picks: ["s3"] }], "0123456789abcdef"),
      "STALE_CONTENT",
      /changed since you opened it/,
    );
    refused(
      await vote([
        { question: "backend", picks: ["s3"] },
        { question: "backend", picks: ["s3"] },
      ]),
      "INVALID_INPUT",
      /answered twice/,
    );
    refused(
      await vote([{ question: "backend", picks: ["nope"] }]),
      "INVALID_INPUT",
      /'nope' is not an option/,
    );
    refused(
      await vote([{ question: "q2", other: "x" }]),
      "INVALID_INPUT",
      /does not accept an answer in other words/,
    );
    refused(
      await vote([{ question: "nope", picks: ["x"] }]),
      "INVALID_INPUT",
      /'nope' is not a question/,
    );
    // Twenty thousand questions the poll does not have: a few are named, and
    // the rest counted, not a megabyte of refusal.
    const many = await vote(
      Array.from({ length: 20000 }, (_, q) => ({ question: `x${q}`, picks: ["a"] })),
    );
    refused(many, "INVALID_INPUT", /'x0' is not a question/);
    assert.ok(JSON.stringify(many).length < 10_000, `${JSON.stringify(many).length} characters`);
    assert.match(JSON.stringify(many), /and 19979 more/);
    refused(
      await vote([
        { question: "backend", picks: ["s3"] },
        { question: "q2", picks: ["size", "max-files-per-issue"] },
      ]),
      "PRECONDITION",
      /already says exactly this/,
    );
  });

  it("finds the issues whose open polls wait on somebody, and those with polls in a state", async () => {
    const ids = async (filter: string) =>
      ok<Payload>(await h.gql(`{ issues(filter: ${filter}) { id } }`)).issues.map(
        (i: Payload) => i.id,
      );
    assert.deepEqual(
      await ids(`{ pollAwaiting: ["person@example.invalid"] }`),
      [issue],
      "the issue's author",
    );
    assert.deepEqual(await ids(`{ pollAwaiting: ["alice@example.com"] }`), [], "who voted");
    assert.deepEqual(await ids(`{ polls: ["open"] }`), [issue]);
    assert.deepEqual(await ids(`{ polls: ["closed"] }`), []);
    refused(
      await h.gql(`{ issues(filter: { polls: ["maybe"] }) { id } }`),
      "INVALID_INPUT",
      /not a poll state/,
    );
    refused(
      await h.gql(`{ issues(filter: { pollAwaiting: ["bob"] }) { id } }`),
      "INVALID_INPUT",
      /'bob' needs an email address/,
    );
  });

  it("keeps a voter's note when a new ballot says nothing of it", async () => {
    const { fingerprint } = await current();
    const changed = ok<Payload>(
      await as(alice)(VOTE, {
        input: { poll, fingerprint, answers: [{ question: "backend", picks: ["local-disk"] }] },
      }),
    ).votePoll;
    assert.equal(changed.poll.myBallot.note, "We run S3.");
    const back = ok<Payload>(
      await as(alice)(VOTE, {
        input: {
          poll,
          fingerprint,
          answers: [
            { question: "backend", picks: ["s3"] },
            { question: "q2", picks: ["size", "max-files-per-issue"] },
          ],
        },
      }),
    ).votePoll;
    assert.equal(back.poll.myBallot.note, "We run S3.");
    assert.deepEqual(statesBy(back.poll.votes), {
      "Alice <alice@example.com>": ["SUPERSEDED", "SUPERSEDED", "COUNTED"],
      "Bob <bob@example.com>": ["COUNTED"],
    });
  });

  it("edits a title without revoking anything, and revokes every ballot when the questions change", async () => {
    let poll_ = await current();
    const titled = ok<Payload>(
      await h.gql(EDIT, {
        input: {
          poll,
          title: "Where attachments live",
          deadline: "2026-12-01",
          baseSha: poll_.baseSha,
        },
      }),
    ).editPoll;
    assert.equal(titled.revoked, 0);
    assert.equal(titled.poll.voters, 2);
    assert.equal(titled.poll.deadline, "2026-12-01");
    assert.equal(titled.commit.subject, `docs(poll): edit ${poll} on #${issue}`);
    refused(
      await h.gql(EDIT, { input: { poll, title: "Stale", baseSha: poll_.baseSha } }),
      "STALE_CONTENT",
      /changed since you opened it/,
    );
    refused(
      await h.gql(EDIT, { input: { poll, baseSha: titled.poll.baseSha } }),
      "INVALID_INPUT",
      /names no field/,
    );
    poll_ = titled.poll;
    const relabelled = structuredClone(QUESTIONS);
    const size = relabelled[1]?.options[0];
    assert.ok(size);
    size.label = "Max attachment size";
    const edited = ok<Payload>(
      await h.gql(EDIT, {
        input: { poll, questions: relabelled, deadline: null, baseSha: poll_.baseSha },
      }),
    ).editPoll;
    assert.equal(edited.revoked, 2);
    assert.equal(edited.poll.voters, 0);
    assert.equal(edited.poll.deadline, null);
    assert.deepEqual(statesBy(edited.poll.votes), {
      "Alice <alice@example.com>": ["SUPERSEDED", "SUPERSEDED", "REVOKED"],
      "Bob <bob@example.com>": ["REVOKED"],
    });
    const shown = ok<Payload>(
      await h.gql(EDIT, {
        input: {
          poll,
          results: "VISIBLE",
          preamble: "Where, and how much.",
          deadline: "",
          baseSha: edited.poll.baseSha,
        },
      }),
    ).editPoll;
    assert.deepEqual(
      [shown.poll.results, shown.poll.preamble, shown.poll.deadline, shown.revoked],
      ["VISIBLE", "Where, and how much.", null, 0],
    );
    const hidden = ok<Payload>(
      await h.gql(EDIT, { input: { poll, results: null, baseSha: shown.poll.baseSha } }),
    ).editPoll;
    assert.equal(hidden.poll.results, "HIDDEN");
    const hers = await current(alice);
    assert.equal(hers.myState, "REVOKED");
    assert.deepEqual(hers.myDraft, {
      answers: [
        { question: "backend", picks: ["s3"], other: null },
        { question: "q2", picks: ["size", "max-files-per-issue"], other: null },
      ],
      note: "We run S3.",
    });
    const ids = ok<Payload>(
      await h.gql(`{ issues(filter: { pollAwaiting: ["alice@example.com"] }) { id } }`),
    );
    assert.deepEqual(
      ids.issues.map((i: Payload) => i.id),
      [issue],
      "asked again",
    );
  });

  it("withdraws a ballot when given no answers", async () => {
    const { fingerprint } = await current();
    const withdrawn = ok<Payload>(
      await as(bob)(VOTE, { input: { poll, fingerprint, answers: [] } }),
    ).votePoll;
    assert.match(withdrawn.commit.subject, /^docs\(poll\): withdraw /);
    assert.equal(withdrawn.poll.myState, "WITHDRAWN");
    refused(
      await as(bob)(VOTE, { input: { poll, fingerprint, answers: [] } }),
      "PRECONDITION",
      /no vote on poll .* to withdraw/,
    );
  });

  it("refuses to break a tie for the closer, closes with their decision, and reopens", async () => {
    const { fingerprint } = await current();
    ok(
      await as(alice)(VOTE, {
        input: { poll, fingerprint, answers: [{ question: "backend", picks: ["s3"] }] },
      }),
    );
    ok(
      await as(bob)(VOTE, {
        input: { poll, fingerprint, answers: [{ question: "backend", picks: ["local-disk"] }] },
      }),
    );
    let poll_ = await current();
    assert.equal(poll_.tallies[0].tied, true);
    // What closing now would leave to the closer, as the close dialog reads it.
    assert.deepEqual(poll_.closingTies, ["backend"]);
    assert.equal(
      poll_.proposed.find((answer: Payload) => answer.question === "backend"),
      undefined,
    );
    refused(
      await h.gql(CLOSE, { input: { poll, baseSha: poll_.baseSha } }),
      "PRECONDITION",
      /tie only you can break/,
    );
    const closed = ok<Payload>(
      await h.gql(CLOSE, {
        input: {
          poll,
          baseSha: poll_.baseSha,
          decisions: [{ question: "backend", picks: ["local-disk"] }, { question: "q2" }],
          note: "Disks for now.",
        },
      }),
    ).closePoll;
    assert.equal(closed.commit.subject, `docs(poll): close ${poll} on #${issue}`);
    assert.equal(closed.poll.status, "CLOSED");
    assert.deepEqual(closed.poll.closingTies, []);
    assert.equal(closed.poll.closedBy, "A Person <person@example.invalid>");
    assert.deepEqual(closed.poll.outcome, [
      { question: "backend", picks: ["local-disk"], other: null },
    ]);
    assert.equal(closed.poll.decisionNote, "Disks for now.");
    assert.equal(closed.issue.ext.poll.polls[0].status, "closed");
    refused(
      await as(alice)(VOTE, {
        input: { poll, fingerprint, answers: [{ question: "backend", picks: ["s3"] }] },
      }),
      "PRECONDITION",
      /is closed; reopen it to vote/,
    );
    poll_ = closed.poll;
    const reopened = ok<Payload>(
      await h.gql(REOPEN, { input: { poll, baseSha: poll_.baseSha } }),
    ).reopenPoll;
    assert.equal(reopened.poll.status, "OPEN");
    assert.equal(reopened.poll.outcome, null);
    assert.equal(reopened.late, 0);
    assert.equal(reopened.commit.subject, `docs(poll): reopen ${poll} on #${issue}`);
  });

  it("reads a poll its issue closed as closed, and its votes' outcome", async () => {
    ok(
      await h.gql(
        `mutation { closeIssue(input: { ref: "${issue}", resolution: "fixed" }) { issue { id } } }`,
      ),
    );
    const closed = await current();
    assert.equal(closed.status, "CLOSED");
    assert.equal(closed.closedByIssue, true);
    assert.equal(closed.outcome.length, 0, "a tie and an unanswered question come to nothing");
    refused(
      await h.gql(REOPEN, { input: { poll, baseSha: closed.baseSha } }),
      "PRECONDITION",
      /reopen the issue/,
    );
  });
});
