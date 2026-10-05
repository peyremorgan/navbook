/**
 * `nav poll <verb>` — polls on issues, at a terminal.
 *
 * Every write goes through the operations in `../core/ops.ts`, the same ones
 * the API calls; this module gathers input, asks questions, and renders.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CliPluginHost } from "@navbook/cli/plugin";
import type { Repo } from "@navbook/core";
import { ballotOf, prefill, type VoterState } from "../core/ballot.ts";
import {
  type Answer,
  type Answers,
  POLL_FILE,
  type PollQuestion,
  useCore,
  validatePollDraft,
} from "../core/files.ts";
import { POLL_STATES } from "../core/index.ts";
import { pollJson, pollSummaryJson } from "../core/json.ts";
import {
  actingVoter,
  applyPollEdit,
  castVote,
  closePoll,
  editPoll,
  issueOf,
  loadTree,
  openPoll,
  parseDraft,
  reopenPoll,
  requireOpenIssue,
  requireOpenPoll,
  resolvePoll,
  revalidateEditedPoll,
} from "../core/ops.ts";
import { allPolls, awaits, type PollRecord, pollsOf, stateOf } from "../core/tree.ts";
import { optionByRef, walkQuestions } from "./interactive.ts";
import {
  describeAnswer,
  label,
  POLL_COLUMNS,
  paintStatus,
  pollRow,
  renderOutcome,
  renderQuestions,
  stateSentence,
  stateWord,
} from "./render.ts";

/**
 * What an editor opens on for a new poll: the grammar, shown by example and
 * commented out, so that saving it unchanged asks nothing and is refused.
 */
function template(title: string): string {
  return `---
title: ${title === "" ? "" : JSON.stringify(title)}
results: hidden
# deadline: 2026-12-31
questions:
#  - text: Which storage backend?
#    other: true            # also accept an answer in the voter's own words
#    options:
#      - label: S3-compatible
#        description: Cheap and durable; needs credentials.
#      - label: Local disk
#  - text: Which limits do we enforce?
#    multi: true            # any number of answers, rather than exactly one
#    options:
#      - label: Max file size
#      - label: Max files per issue
---

${PREAMBLE_HINT}
`;
}

/** The template's placeholder for the preamble, removed when it is left in. */
const PREAMBLE_HINT =
  "<!-- The preamble: what a voter needs to know first. Markdown; may be empty. -->";

export function activate(host: CliPluginHost): void {
  const { core, ctx, ui } = host;
  useCore(core);
  const c = ctx.colors;
  const write = (text: string): void => void ctx.stdout.write(text);

  /** Read `--from`: a file, or stdin for `-`. */
  const readFrom = (from: string): string => {
    try {
      return readFileSync(from === "-" ? 0 : resolve(ctx.cwd, from), "utf8");
    } catch (error) {
      return ui.fail(
        `cannot read ${from === "-" ? "stdin" : from}: ${error instanceof Error ? error.message.replace(/^[A-Z]+: /, "") : String(error)}`,
      );
    }
  };

  /** A poll by reference, among every poll in a tree read afresh. */
  const findPoll = (ref: string, repo: Repo = loadTree(core, ctx)): PollRecord =>
    resolvePoll(core, allPolls(repo), ref);

  /* ------------------------------------------------------------------ open */

  host.command("poll open", ([ref], opts) => {
    const issue = core.findEntity(ctx, "issue", ref as string);
    // Before the editor: nobody should write a poll only to have it refused.
    requireOpenIssue(core, issue);
    const title = opts.title === undefined ? null : String(opts.title);
    let text: string;
    if (opts.from !== undefined) {
      text = readFrom(String(opts.from));
      if (title !== null) text = withTitle(text, title);
    } else {
      text = ui.composeFile({
        bufferName: "NAVBOOK_POLL.md",
        noun: "poll",
        allowEmptyBody: true,
        render: () => template(title ?? ""),
        validate: validatePollDraft,
      }).content;
      text = text
        .split("\n")
        .filter((line) => line.trim() !== PREAMBLE_HINT)
        .join("\n");
    }
    const opened = openPoll(core, ctx, issue, parseDraft(core, text), {
      commit: opts.commit === true,
    });
    write(`Opened poll ${opened.id} on #${issue.id}  ${ctx.navDir}/${opened.dirPath}\n`);
    if (opts.commit) write(`${ui.commitReport(opened.run)}\n`);
  });

  /** Text shaped like `poll.md`, its title replaced. */
  function withTitle(text: string, title: string): string {
    try {
      const nav = core.parseDoc(text);
      core.patchDoc(nav, { title });
      return core.serializeDoc(nav);
    } catch (error) {
      return ui.fail(
        `the poll is not valid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /* ------------------------------------------------------------------ vote */

  host.command("poll vote", ([ref], opts) => {
    const poll = findPoll(ref as string);
    requireOpenPoll(core, poll, "vote");
    const me = core.currentAuthor(ctx);
    const picks = (opts.pick as string[] | undefined) ?? [];
    const others = (opts.other as string[] | undefined) ?? [];
    const clears = (opts.clear as string[] | undefined) ?? [];
    const message = opts.message === undefined ? undefined : String(opts.message);
    const flagged =
      picks.length > 0 || others.length > 0 || clears.length > 0 || message !== undefined;

    let ballot: { answers: Answers; note: string };
    if (opts.withdraw) {
      if (flagged || opts.fresh) ui.fail("--withdraw answers nothing: it takes no other answers");
      ballot = { answers: new Map(), note: "" };
    } else if (flagged || opts.fresh) {
      const start = opts.fresh
        ? { answers: new Map() as Answers, note: null }
        : prefill(poll.questions, poll.ballots, me);
      ballot = {
        answers: applyFlags(poll.questions, start.answers, { picks, others, clears }),
        note: message ?? start.note ?? "",
      };
      if (ballot.answers.size === 0) {
        ui.fail(
          "this ballot answers no question; pass --pick or --other, or --withdraw to take your vote back",
        );
      }
    } else {
      const walked = walk(poll, me, opts.interactive === true);
      if (walked === null) return;
      ballot = walked;
    }
    const result = castVote(core, ctx, poll, ballot, { commit: opts.commit === true });
    write(
      result.withdrawn
        ? `Withdrew your vote on poll ${poll.id}  ${ctx.navDir}/${result.path}\n`
        : `Voted on poll ${poll.id}  ${ctx.navDir}/${result.path}\n`,
    );
    if (opts.commit) write(`${ui.commitReport(result.run)}\n`);
  });

  /**
   * Ask about each question, starting from the voter's last ballot, then
   * confirm once. Null when they declined; nothing is written before the yes.
   */
  function walk(
    poll: PollRecord,
    me: string,
    forced: boolean,
  ): { answers: Answers; note: string } | null {
    if (!forced && !ui.isInteractive()) {
      ui.fail("nothing to vote: pass --pick or --other, or run at a terminal to be asked", [
        `  nav poll show ${poll.id}  lists the questions and their options`,
      ]);
    }
    const state = stateOf(poll, me);
    const start = prefill(poll.questions, poll.ballots, me);
    write(`${c.bold(poll.title)}  ${c.dim(`(${poll.id} on #${poll.issue.id})`)}\n`);
    if (poll.preamble !== "") write(`\n${poll.preamble}\n`);
    if (state === "revoked")
      write(`\n${stateSentence(state, c)}; your last answers are filled in where they still fit\n`);
    const walked = walkQuestions(
      {
        write,
        ask: (question) => ui.ask(question),
        edit: (initial) => ui.editText("NAVBOOK_POLL_NOTE.md", initial),
      },
      poll.questions,
      { answers: start.answers, note: start.note ?? "" },
      c,
    );
    if (walked === null) return ui.fail("no answer; nothing was recorded");
    if (walked.answers.size === 0 && (state === "none" || state === "withdrawn"))
      ui.fail("you answered no question; nothing was recorded");
    write(`\n${summarize(poll.questions, walked.answers, walked.note).join("\n")}\n`);
    const question = walked.answers.size === 0 ? "Withdraw your vote?" : "Cast this ballot?";
    if (!ui.askYesNo(`${question} [y/N] `)) {
      write("Nothing was recorded.\n");
      return null;
    }
    return walked;
  }

  /** A question by its ID, or by its number from 1. */
  function questionByRef(questions: readonly PollQuestion[], ref: string): PollQuestion {
    const byId = questions.find((question) => question.id === ref.toLowerCase());
    if (byId !== undefined) return byId;
    const byNumber = /^\d+$/.test(ref) ? questions[Number(ref) - 1] : undefined;
    if (byNumber !== undefined) return byNumber;
    return ui.fail(
      `'${ref}' is not a question of this poll`,
      questions.map((question, q) => `  ${q + 1}  ${question.id}  ${question.text}`),
    );
  }

  /** `QUESTION=VALUE`, split; a flag without the `=` is refused. */
  function assignment(flag: string, value: string): [string, string] {
    const at = value.indexOf("=");
    if (at <= 0) ui.fail(`${flag} takes QUESTION=…, got '${value}'`);
    return [value.slice(0, at).trim(), value.slice(at + 1)];
  }

  /** Option references, split on commas, resolved against a question. */
  function optionsOf(question: PollQuestion, value: string): string[] {
    const picks: string[] = [];
    for (const ref of value
      .split(",")
      .map((word) => word.trim())
      .filter(Boolean)) {
      const option = optionByRef(question, ref);
      if (option === undefined) {
        return ui.fail(
          `'${ref}' is not an option of question '${question.id}'`,
          question.options.map((o, index) => `  ${index + 1}  ${o.id}  ${o.label}`),
        );
      }
      if (!picks.includes(option)) picks.push(option);
    }
    return picks;
  }

  /**
   * A ballot from flags, over the one it starts from: `--clear` first, then
   * `--pick`, then `--other`. On a single-choice question a pick and a
   * write-in exclude each other, so giving both is refused.
   */
  function applyFlags(
    questions: readonly PollQuestion[],
    start: Answers,
    flags: { picks: string[]; others: string[]; clears: string[] },
  ): Answers {
    const answers: Answers = new Map(start);
    for (const ref of flags.clears) answers.delete(questionByRef(questions, ref).id);
    const picked = new Set<string>();
    for (const value of flags.picks) {
      const [ref, list] = assignment("--pick", value);
      const question = questionByRef(questions, ref);
      const picks = optionsOf(question, list);
      if (picks.length === 0)
        ui.fail(`--pick ${ref}= names no option; use --clear ${ref} to skip it`);
      picked.add(question.id);
      const was = answers.get(question.id);
      answers.set(question.id, { picks, other: question.multi ? (was?.other ?? null) : null });
    }
    for (const value of flags.others) {
      const [ref, text] = assignment("--other", value);
      const question = questionByRef(questions, ref);
      if (text.trim() === "") ui.fail(`--other ${ref}= is empty; use --clear ${ref} to skip it`);
      if (!question.multi && picked.has(question.id)) {
        ui.fail(`question '${question.id}' takes one answer: --pick or --other, not both`);
      }
      const was = answers.get(question.id);
      answers.set(question.id, { picks: question.multi ? (was?.picks ?? []) : [], other: text });
    }
    return answers;
  }

  /** A ballot, as the confirmation shows it. */
  function summarize(questions: readonly PollQuestion[], answers: Answers, note: string): string[] {
    if (answers.size === 0) return [c.bold("This ballot answers nothing: it withdraws your vote.")];
    const lines = [c.bold("Your ballot:")];
    questions.forEach((question, q) => {
      const answer = answers.get(question.id);
      lines.push(
        `  ${q + 1}. ${question.text}  ${c.dim("→")} ${answer === undefined ? c.dim("skipped") : describeAnswer(question, answer)}`,
      );
    });
    if (note !== "")
      lines.push(`  ${c.dim("note:")} ${note.split("\n")[0]}${note.includes("\n") ? " …" : ""}`);
    return lines;
  }

  /* ------------------------------------------------------------------ show */

  host.command("poll show", ([ref], opts) => {
    const repo = loadTree(core, ctx);
    const poll = findPoll(ref as string, repo);
    const me = actingVoter(core, ctx);
    if (opts.json) {
      write(`${JSON.stringify(pollJson(ctx.navDir, poll, me))}\n`);
      return;
    }
    const mine = me === null ? undefined : ballotOf(poll.ballots, me);
    const state: VoterState = mine?.state ?? "none";
    // Only a ballot that counts answered these questions: a revoked one's
    // picks may name options that mean something else now.
    const counting = mine?.state === "counted" ? mine.vote.answers : undefined;
    const shown =
      opts.results === true ||
      poll.results === "visible" ||
      poll.status === "closed" ||
      state === "counted";
    const issue = issueOf(repo, poll);
    const lines = [`${c.bold(poll.id)}  ${poll.title}  ${paintStatus(poll, c)}`, ""];
    lines.push(
      `${label("issue", c)}#${poll.issue.id}${issue === undefined ? "" : `  ${issue.title}`}`,
    );
    lines.push(`${label("author", c)}${poll.author}`);
    lines.push(`${label("created", c)}${poll.created}`);
    if (poll.deadline !== null) lines.push(`${label("deadline", c)}${poll.deadline}`);
    lines.push(`${label("voters", c)}${poll.voters}`);
    if (me !== null && poll.status === "open")
      lines.push(`${label("you", c)}${stateSentence(state, c)}`);
    lines.push(`${label("path", c)}${ctx.navDir}/${poll.dirPath}`);
    if (poll.preamble !== "") lines.push("", poll.preamble);
    lines.push("");
    if (!shown) lines.push(c.dim("Results are hidden until you vote; --results shows them."), "");
    lines.push(
      ...renderQuestions(poll, c, {
        results: shown,
        ...(counting === undefined ? {} : { mine: counting }),
      }),
    );
    if (poll.outcome !== null) {
      lines.push(
        "",
        poll.closedByIssue
          ? c.dim(`closed with #${poll.issue.id}; by its votes it came to:`)
          : c.dim(`closed ${poll.closed} by ${poll.closedBy}; decided:`),
      );
      lines.push(...renderOutcome(poll, poll.outcome, c));
      if (poll.decisionNote !== null) lines.push("", poll.decisionNote);
    }
    if (poll.problems.length > 0) {
      lines.push(
        "",
        c.red(
          `${POLL_FILE} has faults (nav doctor lists them); nothing can be changed until they are fixed`,
        ),
      );
    }
    write(`${lines.join("\n")}\n`);
  });

  /* ------------------------------------------------------------------ list */

  host.command("poll list", (_args, opts) => {
    const state = opts.state === undefined ? null : String(opts.state).toLowerCase();
    if (state !== null && state !== "open" && state !== "closed")
      ui.fail(`--state takes open or closed, got '${String(opts.state)}'`);
    const awaitingOnly = opts.all !== true && state === null && opts.issue === undefined;
    const me = actingVoter(core, ctx);
    if (awaitingOnly && me === null) {
      ui.fail("git does not say who you are (user.email), so nothing can be waiting on you", [
        "  pass --all to list every poll",
      ]);
    }
    const repo = loadTree(core, ctx, { comments: awaitingOnly });
    let issueId: string | null = null;
    if (opts.issue !== undefined)
      issueId = core.resolveEntity(repo, String(opts.issue), "issue").id;
    const rows = allPolls(repo)
      .filter((poll) => issueId === null || poll.issue.id === issueId)
      .filter((poll) => state === null || poll.status === state)
      .filter((poll) => {
        const issue = awaitingOnly ? issueOf(repo, poll) : undefined;
        return !awaitingOnly || (issue !== undefined && awaits(issue, poll, me as string));
      });

    if (opts.json) {
      if (rows.length > 0) {
        const objects = rows.map((poll) => pollSummaryJson(ctx.navDir, poll, me));
        write(`${core.toNdjson(objects)}\n`);
      }
      return;
    }
    if (rows.length === 0) {
      write(awaitingOnly ? "No polls are waiting on you.\n" : "No polls match.\n");
      return;
    }
    write(
      `${ui.renderTable(
        [...POLL_COLUMNS],
        rows.map((poll) => pollRow(poll, me === null ? null : stateOf(poll, me))),
      )}\n`,
    );
  });

  /* ------------------------------------------------------------------ edit */

  host.command("poll edit", ([ref], opts) => {
    const poll = findPoll(ref as string);
    requireOpenPoll(core, poll, "edit it");
    let edited: { revoked: number; run: { committed: boolean; subject: string } };
    if (opts.from !== undefined) {
      const draft = parseDraft(core, readFrom(String(opts.from)));
      edited = editPoll(core, ctx, poll, draft, { commit: opts.commit === true });
    } else {
      const path = core.absPath(ctx, poll.filePath);
      const before = readFileSync(path, "utf8");
      ui.editFile(path);
      if (readFileSync(path, "utf8") === before) {
        write(`No change to ${ctx.navDir}/${poll.filePath}\n`);
        return;
      }
      const problems = revalidateEditedPoll(core, path);
      if (problems.length > 0) {
        ui.fail(
          `${ctx.navDir}/${poll.filePath} is no longer valid; it was left as you saved it`,
          problems.map((problem) => `  ${problem}`),
        );
      }
      edited = applyPollEdit(core, ctx, poll, { commit: opts.commit === true });
    }
    write(`Edited poll ${poll.id}  ${ctx.navDir}/${poll.filePath}\n`);
    if (edited.revoked > 0) {
      write(
        `${c.yellow(`The questions changed: ${edited.revoked} vote${edited.revoked === 1 ? " was" : "s were"} revoked, and will count again once cast anew.`)}\n`,
      );
    }
    if (opts.commit) write(`${ui.commitReport(edited.run)}\n`);
  });

  /* ----------------------------------------------------------------- close */

  host.command("poll close", ([ref], opts) => {
    const poll = findPoll(ref as string);
    const decide = new Map<string, Answer | null>();
    for (const value of (opts.decide as string[] | undefined) ?? []) {
      const [qref, list] = assignment("--decide", value);
      const question = questionByRef(poll.questions, qref);
      const picks = optionsOf(question, list);
      decide.set(question.id, picks.length === 0 ? null : { picks, other: null });
    }
    for (const value of (opts.decideOther as string[] | undefined) ?? []) {
      const [qref, text] = assignment("--decide-other", value);
      const question = questionByRef(poll.questions, qref);
      const was = decide.get(question.id);
      decide.set(question.id, { picks: was?.picks ?? [], other: text });
    }
    const closed = closePoll(
      core,
      ctx,
      poll,
      { decide, note: opts.message === undefined ? null : String(opts.message) },
      { commit: opts.commit === true },
    );
    write(`Closed poll ${poll.id}  ${poll.title}\n`);
    write(`${renderOutcome(poll, closed.decision, c).join("\n")}\n`);
    if (opts.commit) write(`${ui.commitReport(closed.run)}\n`);
  });

  /* ---------------------------------------------------------------- reopen */

  host.command("poll reopen", ([ref], opts) => {
    const poll = findPoll(ref as string);
    const reopened = reopenPoll(core, ctx, poll, { commit: opts.commit === true });
    write(`Reopened poll ${poll.id}  ${poll.title}\n`);
    if (reopened.late > 0) {
      write(
        `${c.yellow(`${reopened.late} vote${reopened.late === 1 ? " was" : "s were"} cast while it was closed; ${reopened.late === 1 ? "it counts" : "they count"} now.`)}\n`,
      );
    }
    if (opts.commit) write(`${ui.commitReport(reopened.run)}\n`);
  });

  /* ------------------------------------------------------------ the issue */

  host.contribute("issue show", {
    showSection: (entity) => {
      const polls = pollsOf(entity);
      if (polls.length === 0) return [];
      const me = actingVoter(core, ctx);
      const lines = [c.dim(`polls (${polls.length}):`)];
      for (const poll of polls) {
        const where =
          me === null || poll.status !== "open" ? "" : `  ${c.dim(stateWord(stateOf(poll, me)))}`;
        lines.push(
          `  ${poll.id}  ${ui.pad(paintStatus(poll, c), 6)}  ${String(poll.voters).padStart(2)} voter${poll.voters === 1 ? " " : "s"}${where}  ${poll.title}`,
        );
      }
      return lines;
    },
    jsonExtra: (entity) => {
      const me = actingVoter(core, ctx);
      return { polls: pollsOf(entity).map((poll) => pollSummaryJson(ctx.navDir, poll, me)) };
    },
  });

  host.contribute("issue list", {
    listCompletions: () => {
      const me = actingVoter(core, ctx);
      return [
        ...POLL_STATES.map((state) => `poll:${state}`),
        ...(me === null ? [] : [`poll-awaiting:${me}`]),
      ];
    },
  });

  /* ---------------------------------------------------------- completion */

  const quietly = (answer: () => string[]): string[] => {
    try {
      return answer();
    } catch {
      return [];
    }
  };
  host.completer("issue", () =>
    quietly(() =>
      loadTree(core, ctx)
        .issues.filter((issue) => issue.status === "open")
        .map((issue) => issue.id),
    ),
  );
  host.completer("poll", () => quietly(() => allPolls(loadTree(core, ctx)).map((poll) => poll.id)));
  host.completer("open-poll", () =>
    quietly(() =>
      allPolls(loadTree(core, ctx))
        .filter((poll) => poll.status === "open")
        .map((poll) => poll.id),
    ),
  );
}
