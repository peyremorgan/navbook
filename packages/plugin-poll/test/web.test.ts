/**
 * The web layer's pure helpers: what a row's `ext` says, when the results are
 * shown, a ballot being filled in, what closing proposes, and whether an edit
 * revokes the ballots cast.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ballotFaults,
  bodyText,
  carryOver,
  closeDefaults,
  decisionsToInput,
  describeAnswer,
  draftFrom,
  draftToInput,
  draftToQuestions,
  own,
  questionsFault,
  questionsToDraft,
  readPollExt,
  resultsShown,
  sameBallot,
  share,
  wouldRevoke,
} from "../web/app/utils/poll.ts";
import type { PollCardFragment } from "../web/src/generated/gql/graphql.ts";

type Questions = PollCardFragment["questions"];

/** A record keyed by question ID, which has no prototype, as a plain object to compare. */
const plain = <T>(record: Record<string, T>): Record<string, T> => ({ ...record });

const QUESTIONS: Questions = [
  {
    id: "backend",
    text: "Which storage backend?",
    multi: false,
    other: true,
    options: [
      { id: "s3", label: "S3-compatible", description: "Cheap." },
      { id: "disk", label: "Local disk", description: null },
    ],
  },
  {
    id: "limits",
    text: "Which limits?",
    multi: true,
    other: false,
    options: [
      { id: "size", label: "Max file size", description: null },
      { id: "count", label: "Max files", description: null },
    ],
  },
];

describe("a row's ext", () => {
  it("reads this plugin's slice, and nothing from a row without one", () => {
    const poll = {
      id: "p4w8n2x6",
      title: "Storage",
      created: "2026-10-04T10:00:00Z",
      status: "open",
      voters: 2,
    };
    assert.deepEqual(readPollExt({ poll: { polls: [poll] } }), [poll]);
    assert.deepEqual(readPollExt({ kb: {} }), []);
    assert.deepEqual(readPollExt(null), []);
    assert.deepEqual(readPollExt({ poll: { polls: [{ title: "no id" }, 7] } }), []);
  });
});

describe("results", () => {
  const poll = (
    results: "HIDDEN" | "VISIBLE",
    status: "OPEN" | "CLOSED",
    myState: PollCardFragment["myState"],
  ) => ({
    results,
    status,
    myState,
  });

  it("are hidden until the person has a ballot that counts, unless asked for, visible, or closed", () => {
    assert.equal(resultsShown(poll("HIDDEN", "OPEN", "NONE"), false), false);
    assert.equal(resultsShown(poll("HIDDEN", "OPEN", "REVOKED"), false), false);
    assert.equal(resultsShown(poll("HIDDEN", "OPEN", "WITHDRAWN"), false), false);
    assert.equal(resultsShown(poll("HIDDEN", "OPEN", "NONE"), true), true);
    assert.equal(resultsShown(poll("HIDDEN", "OPEN", "COUNTED"), false), true);
    assert.equal(resultsShown(poll("VISIBLE", "OPEN", "NONE"), false), true);
    assert.equal(resultsShown(poll("HIDDEN", "CLOSED", "NONE"), false), true);
  });

  it("draw a share of the answers, and nothing of none", () => {
    assert.equal(share(1, 3), 33);
    assert.equal(share(0, 0), 0);
    assert.equal(share(2, 2), 100);
  });
});

describe("a ballot being filled in", () => {
  it("starts from the answers given, less what no longer fits", () => {
    const draft = draftFrom(QUESTIONS, [
      { question: "backend", picks: ["s3", "gone"], other: "MinIO" },
      { question: "limits", picks: ["size", "count"], other: "ignored" },
      { question: "removed", picks: ["x"] },
    ]);
    assert.deepEqual(plain(draft), {
      backend: { picks: ["s3"], other: "MinIO" },
      limits: { picks: ["size", "count"], other: "" },
    });
    assert.deepEqual(plain(draftFrom(QUESTIONS)), {
      backend: { picks: [], other: "" },
      limits: { picks: [], other: "" },
    });
  });

  it("is carried onto questions that changed under it, where it still fits", () => {
    const changed: Questions = [
      { ...(QUESTIONS[0] as Questions[number]), other: false },
      {
        ...(QUESTIONS[1] as Questions[number]),
        options: [{ id: "count", label: "Max files", description: null }],
      },
    ];
    assert.deepEqual(
      plain(
        carryOver(changed, {
          backend: { picks: [], other: "MinIO" },
          limits: { picks: ["size", "count"], other: "" },
        }),
      ),
      { backend: { picks: [], other: "" }, limits: { picks: ["count"], other: "" } },
    );
  });

  it("is sent as one answer per question with something in it, write-ins trimmed", () => {
    assert.deepEqual(
      draftToInput(QUESTIONS, {
        backend: { picks: [], other: "  MinIO  " },
        limits: { picks: [], other: "" },
      }),
      [{ question: "backend", picks: [], other: "MinIO" }],
    );
    assert.deepEqual(draftToInput(QUESTIONS, { backend: { picks: [], other: "   " } }), []);
  });

  it("says what the API would refuse, beside the question", () => {
    assert.deepEqual(
      plain(
        ballotFaults(QUESTIONS, {
          backend: { picks: ["s3"], other: "also this" },
          limits: { picks: ["size", "count"], other: "" },
        }),
      ),
      { backend: "One answer: an option, or one in your own words." },
    );
    // A line break is any of the format's, not only the ASCII two (`doc/spec.md` §3.1).
    for (const lineBreak of ["\n", "\r", "\u0085", "\u2028", "\u2029"]) {
      assert.deepEqual(
        plain(ballotFaults(QUESTIONS, { backend: { picks: [], other: `two${lineBreak}lines` } })),
        { backend: "Write your answer on one line." },
        JSON.stringify(lineBreak),
      );
    }
  });

  it("compares notes as the server keeps them, indentation of the first line included", () => {
    assert.equal(bodyText("\n\n    code\n  \n"), "    code");
    assert.equal(bodyText("Plain."), "Plain.");
    assert.equal(bodyText("   \n  "), "");
  });

  it("knows a ballot that says what the last one did", () => {
    const draft = {
      backend: { picks: ["s3"], other: "" },
      limits: { picks: ["count", "size"], other: "" },
    };
    const cast = [
      { question: "backend", picks: ["s3"], other: null },
      { question: "limits", picks: ["size", "count"], other: null },
    ];
    assert.equal(sameBallot(QUESTIONS, draft, cast), true);
    assert.equal(
      sameBallot(QUESTIONS, { ...draft, limits: { picks: ["size"], other: "" } }, cast),
      false,
    );
    assert.equal(sameBallot(QUESTIONS, draft, null), false);
  });

  it("is described in words", () => {
    assert.equal(
      describeAnswer(QUESTIONS[0], { question: "backend", picks: ["disk"], other: "MinIO" }),
      "Local disk, “MinIO”",
    );
    assert.equal(describeAnswer(undefined, { question: "x", picks: ["gone"] }), "gone");
  });
});

describe("a question whose ID an object already has", () => {
  // `constructor` is a slug, so a question ID (`doc/spec.md` §3.1); on a plain
  // object it reads as `Object`, which a form then showed as its fault.
  const asked: Questions = [
    {
      id: "constructor",
      text: "Who builds it?",
      multi: false,
      other: false,
      options: [
        { id: "us", label: "Us", description: null },
        { id: "them", label: "Them", description: null },
      ],
    },
  ];

  it("has no fault, no answer and no decision until one is given", () => {
    const draft = draftFrom(asked);
    assert.equal(own(ballotFaults(asked, draft), "constructor"), undefined);
    assert.equal(ballotFaults(asked, draft).constructor, undefined);
    assert.deepEqual(draftToInput(asked, {}), []);
    assert.deepEqual(draftToInput(asked, draft), []);
    assert.deepEqual(decisionsToInput(asked, {}), [
      { question: "constructor", picks: [], other: null },
    ]);
    const { decisions } = closeDefaults({ questions: asked, proposed: [], closingTies: [] });
    assert.deepEqual(plain(decisions), { constructor: null });
    assert.equal(own({}, "constructor"), undefined);
  });

  it("is answered like any other", () => {
    const draft = draftFrom(asked, [{ question: "constructor", picks: ["us"] }]);
    assert.deepEqual(own(draft, "constructor"), { picks: ["us"], other: "" });
    assert.deepEqual(draftToInput(asked, draft), [
      { question: "constructor", picks: ["us"], other: null },
    ]);
    assert.equal(sameBallot(asked, draft, [{ question: "constructor", picks: ["us"] }]), true);
  });
});

describe("closing", () => {
  it("starts from what closing would come to, and leaves its ties to the closer", () => {
    // As closing would read the ballots, which may not be as the tallies shown
    // read them: a vote stamped far ahead of the clock is late once closed.
    const { decisions, mustChoose } = closeDefaults({
      questions: QUESTIONS,
      proposed: [{ question: "limits", picks: ["size"], other: null }],
      closingTies: ["backend"],
    });
    assert.deepEqual(plain(decisions), {
      backend: null,
      limits: { picks: ["size"], other: "" },
    });
    assert.deepEqual(mustChoose, ["backend"]);
  });

  it("sends every question, an undecided one with nothing in it", () => {
    assert.deepEqual(
      decisionsToInput(QUESTIONS, { backend: { picks: [], other: " MinIO " }, limits: null }),
      [
        { question: "backend", picks: [], other: "MinIO" },
        { question: "limits", picks: [], other: null },
      ],
    );
  });
});

describe("the editor", () => {
  it("holds a poll's questions as rows, and gives them back as the API takes them", () => {
    const rows = questionsToDraft(QUESTIONS);
    assert.equal(rows.length, 2);
    assert.deepEqual(draftToQuestions(rows), [
      {
        id: "backend",
        text: "Which storage backend?",
        multi: false,
        other: true,
        options: [
          { id: "s3", label: "S3-compatible", description: "Cheap." },
          { id: "disk", label: "Local disk", description: null },
        ],
      },
      {
        id: "limits",
        text: "Which limits?",
        multi: true,
        other: false,
        options: [
          { id: "size", label: "Max file size", description: null },
          { id: "count", label: "Max files", description: null },
        ],
      },
    ]);
    const fresh = questionsToDraft([]);
    assert.equal(fresh.length, 1);
    assert.equal(fresh[0]?.options.length, 2);
  });

  it("says what the API would refuse", () => {
    const rows = questionsToDraft(QUESTIONS);
    assert.equal(questionsFault(rows), null);
    assert.equal(questionsFault([]), "A poll asks at least one question.");
    const noText = questionsToDraft(QUESTIONS);
    noText[1] = { ...(noText[1] as (typeof noText)[number]), text: " " };
    assert.equal(questionsFault(noText), "Question 2 needs its text.");
    const lonely = questionsToDraft(QUESTIONS);
    const second = lonely[1] as (typeof lonely)[number];
    second.options = second.options.slice(0, 1);
    assert.equal(
      questionsFault(lonely),
      "Question 2 needs a second option, or to accept answers in other words.",
    );
    second.other = true;
    assert.equal(questionsFault(lonely), null);
    const unlabelled = questionsToDraft(QUESTIONS);
    (unlabelled[0] as (typeof unlabelled)[number]).options[1] = {
      key: 99,
      id: "",
      label: "",
      description: "",
    };
    assert.equal(questionsFault(unlabelled), "Question 1 has an option with no label.");
  });

  it("knows an edit revokes the ballots when the questions change at all, and not otherwise", () => {
    const same = questionsToDraft(QUESTIONS);
    assert.equal(wouldRevoke(QUESTIONS, same), false);
    // Trailing whitespace in a description is formatting (`doc/spec.md` §3.1).
    (same[0] as (typeof same)[number]).options[0] = {
      ...((same[0] as (typeof same)[number])
        .options[0] as (typeof same)[number]["options"][number]),
      description: "Cheap.\n",
    };
    assert.equal(wouldRevoke(QUESTIONS, same), false);
    const reworded = questionsToDraft(QUESTIONS);
    (reworded[1] as (typeof reworded)[number]).text = "Which limits, really?";
    assert.equal(wouldRevoke(QUESTIONS, reworded), true);
    const added = questionsToDraft(QUESTIONS);
    (added[1] as (typeof added)[number]).options.push({
      key: 98,
      id: "",
      label: "Max size per issue",
      description: "",
    });
    assert.equal(wouldRevoke(QUESTIONS, added), true);
    // Spaces a hand-written file put around a text are not an edit.
    const padded: Questions = QUESTIONS.map((question) => ({
      ...question,
      text: ` ${question.text} `,
      options: question.options.map((option) => ({ ...option, label: `${option.label} ` })),
    }));
    assert.equal(wouldRevoke(padded, questionsToDraft(padded)), false);
    const flipped = questionsToDraft(QUESTIONS);
    (flipped[0] as (typeof flipped)[number]).multi = true;
    assert.equal(wouldRevoke(QUESTIONS, flipped), true);
  });
});
