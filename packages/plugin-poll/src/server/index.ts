/**
 * Polls on issues: the API half — `doc/spec.md`, spec 06 §6.3.
 *
 * Reads take the tree through the request's context, as every built-in
 * resolver does; writes go through `ctx.sync.write` and the same operations
 * `nav poll` runs. The person acting is the one the token names: a ballot cast
 * here is theirs, and `myState` is where they stand.
 */

import type { EntityRecord, RunPlanResult } from "@navbook/core";
import type { GraphQLCtx, ServerPluginHost } from "@navbook/server/plugin";
import { type BallotState, ballotOf, prefill } from "../core/ballot.ts";
import type { Answer, Answers, DraftQuestion, PollChanges, Results } from "../core/files.ts";
import { useCore } from "../core/files.ts";
import { awaitedOf, POLL_STATES, pollStateOf } from "../core/index.ts";
import {
  castVote,
  closePoll,
  editPoll,
  issueOf,
  openPoll,
  reopenPoll,
  resolvePoll,
} from "../core/ops.ts";
import { allPolls, type PollRecord, pollsOf, stateOf, type VoteRecord } from "../core/tree.ts";

const COMMIT = { commit: true } as const;

/** A state as the SDL's enums spell it. */
const toEnum = (state: string): string => state.toUpperCase();

/** A vote as `PollVote` resolves it: the record, and what became of it. */
interface VoteParent {
  vote: VoteRecord;
  state: BallotState | "invalid";
}

interface AnswerInput {
  question: string;
  picks: readonly string[];
  other?: string | null;
}

interface QuestionInput {
  id?: string | null;
  text: string;
  multi?: boolean | null;
  other?: boolean | null;
  options: { id?: string | null; label: string; description?: string | null }[];
}

export function activate(host: ServerPluginHost): void {
  const { core, api } = host;
  useCore(core);

  /* ------------------------------------------------------------- helpers */

  /** Answers as the SDL lists them: one per question, in the order given. */
  const answerList = (answers: Answers | null) =>
    answers === null
      ? null
      : [...answers].map(([question, answer]) => ({
          question,
          picks: [...answer.picks],
          other: answer.other,
        }));

  /** Answers from a mutation, refusing a question named twice. */
  function answersFrom(list: readonly AnswerInput[]): Map<string, Answer> {
    const answers = new Map<string, Answer>();
    for (const entry of list) {
      if (answers.has(entry.question))
        throw api.invalidInput(`question '${entry.question}' is answered twice`);
      answers.set(entry.question, { picks: [...entry.picks], other: entry.other ?? null });
    }
    return answers;
  }

  const questionsFrom = (list: readonly QuestionInput[]): DraftQuestion[] =>
    list.map((question) => ({
      id: question.id ?? null,
      text: question.text,
      multi: question.multi ?? false,
      other: question.other ?? false,
      options: question.options.map((option) => ({
        id: option.id ?? null,
        label: option.label,
        description: option.description ?? null,
      })),
    }));

  const fromResults = (value: string): Results => value.toLowerCase() as Results;

  /** The viewer's address, as a ballot is keyed. */
  const viewer = (ctx: GraphQLCtx): string => ctx.viewer.email;

  /**
   * A poll to write to, in the served tree. Its issue is there too — a poll is
   * read out of its issue's directory — so, unlike a pull request's, it needs
   * no `writeTarget` to find where to write.
   */
  function pollToWrite(ctx: GraphQLCtx, ref: string): PollRecord {
    return resolvePoll(core, allPolls(ctx.loadRepo("none")), ref);
  }

  /** The poll as a write has just left it, read back inside the transaction, and its issue. */
  function after(ctx: GraphQLCtx, id: string): { poll: PollRecord; issue: EntityRecord } {
    ctx.invalidateRepo();
    const repo = ctx.loadRepo("none");
    const poll = resolvePoll(core, allPolls(repo), id);
    return { poll, issue: issueOf(repo, poll) as EntityRecord };
  }

  /** A write and its payload: the transaction, the read-back, the commit. */
  async function written(
    ctx: GraphQLCtx,
    write: () => { id: string; run: RunPlanResult; revoked?: number; late?: number },
  ) {
    const { result, pushed } = await ctx.sync.write(
      () => {
        const done = write();
        return { ...done, ...after(ctx, done.id) };
      },
      (r) => r.run.committed,
    );
    return {
      poll: result.poll,
      issue: result.issue,
      revoked: result.revoked ?? 0,
      late: result.late ?? 0,
      commit: api.commitInfo(ctx, result.run, pushed),
    };
  }

  /* ------------------------------------------------------ host's inputs */

  const fail = (message: string): never => {
    throw api.invalidInput(message);
  };

  // The fields this plugin's SDL adds to `IssueFilter`, onto the query terms
  // the core half registered. Checked here, because a filter never passes
  // through the terms' own parsers.
  host.entityInput({
    filterTerms: (filter): Record<string, string[]> => {
      const terms: Record<string, string[]> = {};
      const states = filter.polls;
      if (Array.isArray(states) && states.length > 0) {
        terms.poll = states.map(
          (value) =>
            pollStateOf(String(value)) ??
            fail(
              `'${String(value)}' is not a poll state; expected one of ${POLL_STATES.join(", ")}`,
            ),
        );
      }
      const people = filter.pollAwaiting;
      if (Array.isArray(people) && people.length > 0) {
        terms["poll-awaiting"] = people.map(
          (value) => awaitedOf(String(value)) ?? fail(`'${String(value)}' needs an email address`),
        );
      }
      return terms;
    },
  });

  // What an issue's row and its page need without asking for the polls: the
  // same for every viewer, so the host may cache it with the issue.
  host.entityExt((entity: EntityRecord) => {
    if (entity.kind !== "issue") return undefined;
    return {
      polls: pollsOf(entity).map((poll) => ({
        id: poll.id,
        title: poll.title,
        created: poll.created,
        status: poll.status,
        voters: poll.voters,
      })),
    };
  });

  /* ---------------------------------------------------------- resolvers */

  host.resolvers({
    Query: {
      poll: (_parent: unknown, { id }: { id: string }, ctx: GraphQLCtx) =>
        api.run(() => ctx.sync.read(() => resolvePoll(core, allPolls(ctx.loadRepo("none")), id))),
    },

    Issue: {
      polls: (issue: EntityRecord) => pollsOf(issue),
    } as never,

    Poll: {
      issue: async (poll: PollRecord, _args: unknown, ctx: GraphQLCtx) =>
        issueOf(await ctx.repo(), poll),
      path: (poll: PollRecord, _args: unknown, ctx: GraphQLCtx) =>
        `${ctx.ws.navDir}/${poll.dirPath}`,
      baseSha: (poll: PollRecord) => poll.blobSha,
      results: (poll: PollRecord) => toEnum(poll.results),
      status: (poll: PollRecord) => toEnum(poll.status),
      outcome: (poll: PollRecord) => answerList(poll.outcome),
      proposed: (poll: PollRecord) => answerList(poll.proposed),
      votes: (poll: PollRecord) => {
        // Each vote's state once, not a search per vote.
        const states = new Map(poll.ballots.map((reading) => [reading.vote, reading.state]));
        return poll.votes.map((vote) => ({ vote, state: states.get(vote) ?? "invalid" }));
      },
      myState: (poll: PollRecord, _args: unknown, ctx: GraphQLCtx) =>
        toEnum(stateOf(poll, viewer(ctx))),
      myBallot: (poll: PollRecord, _args: unknown, ctx: GraphQLCtx) => {
        const mine = ballotOf(poll.ballots, viewer(ctx));
        return mine === undefined ? null : { vote: mine.vote, state: mine.state };
      },
      myDraft: (poll: PollRecord, _args: unknown, ctx: GraphQLCtx) => {
        const draft = prefill(poll.questions, poll.ballots, viewer(ctx));
        return { answers: answerList(draft.answers), note: draft.note ?? "" };
      },
      problems: (poll: PollRecord) => poll.problems.map((problem) => problem.message),
    },

    PollVote: {
      id: ({ vote }: VoteParent) => vote.id,
      path: ({ vote }: VoteParent, _args: unknown, ctx: GraphQLCtx) =>
        `${ctx.ws.navDir}/${vote.path}`,
      author: ({ vote }: VoteParent) => vote.author,
      cast: ({ vote }: VoteParent) => vote.cast,
      state: ({ state }: VoteParent) => toEnum(state),
      answers: ({ vote }: VoteParent) => answerList(vote.answers),
      note: ({ vote }: VoteParent) => vote.note,
      problems: ({ vote }: VoteParent) => vote.problems.map((problem) => problem.message),
    },

    Mutation: {
      openPoll: (
        _parent: unknown,
        {
          input,
        }: {
          input: {
            issue: string;
            title: string;
            preamble?: string | null;
            results?: string | null;
            deadline?: string | null;
            questions: QuestionInput[];
          };
        },
        ctx: GraphQLCtx,
      ) =>
        api.run(async () => {
          api.requireText(input.title, "title");
          return written(ctx, () => {
            const issue = api.writeTarget(ctx, "issue", input.issue);
            const opened = openPoll(
              core,
              ctx.ws,
              issue,
              {
                title: input.title,
                preamble: input.preamble ?? "",
                results: input.results == null ? null : fromResults(input.results),
                deadline: input.deadline?.trim() || null,
                questions: questionsFrom(input.questions),
              },
              COMMIT,
            );
            return { id: opened.id, run: opened.run };
          });
        }),

      editPoll: (
        _parent: unknown,
        {
          input,
        }: {
          input: {
            poll: string;
            title?: string | null;
            preamble?: string | null;
            results?: string | null;
            deadline?: string | null;
            questions?: QuestionInput[] | null;
            baseSha: string;
          };
        },
        ctx: GraphQLCtx,
      ) =>
        api.run(async () => {
          // `undefined` keeps a field; `null` is a value only results and the
          // deadline take, and means "remove it".
          const changes: PollChanges = {};
          if (input.title != null) {
            api.requireText(input.title, "title");
            changes.title = input.title;
          }
          if (input.preamble != null) changes.preamble = input.preamble;
          if (input.results !== undefined)
            changes.results = input.results === null ? null : fromResults(input.results);
          if (input.deadline !== undefined) changes.deadline = input.deadline?.trim() || null;
          if (input.questions != null) changes.questions = questionsFrom(input.questions);
          if (Object.keys(changes).length === 0)
            throw api.invalidInput("the patch names no field to change");
          return written(ctx, () => {
            const poll = pollToWrite(ctx, input.poll);
            const edited = editPoll(core, ctx.ws, poll, changes, {
              ...COMMIT,
              baseSha: input.baseSha,
            });
            return { id: poll.id, run: edited.run, revoked: edited.revoked };
          });
        }),

      votePoll: (
        _parent: unknown,
        {
          input,
        }: {
          input: {
            poll: string;
            fingerprint: string;
            answers: AnswerInput[];
            note?: string | null;
          };
        },
        ctx: GraphQLCtx,
      ) =>
        api.run(async () => {
          const answers = answersFrom(input.answers);
          return written(ctx, () => {
            const poll = pollToWrite(ctx, input.poll);
            // As `nav poll vote` does: a ballot that says nothing of its note
            // keeps the last one, and a withdrawal needs none.
            const kept = prefill(poll.questions, poll.ballots, viewer(ctx)).note ?? "";
            const note = input.note ?? (answers.size === 0 ? "" : kept);
            const cast = castVote(
              core,
              ctx.ws,
              poll,
              { answers, note },
              { ...COMMIT, fingerprint: input.fingerprint },
            );
            return { id: poll.id, run: cast.run };
          });
        }),

      closePoll: (
        _parent: unknown,
        {
          input,
        }: {
          input: { poll: string; decisions: AnswerInput[]; note?: string | null; baseSha: string };
        },
        ctx: GraphQLCtx,
      ) =>
        api.run(async () => {
          const decide = new Map<string, Answer | null>(
            [...answersFrom(input.decisions)].map(([question, answer]) => [
              question,
              answer.picks.length === 0 && !answer.other?.trim() ? null : answer,
            ]),
          );
          return written(ctx, () => {
            const poll = pollToWrite(ctx, input.poll);
            const closed = closePoll(
              core,
              ctx.ws,
              poll,
              { decide, note: input.note ?? null },
              { ...COMMIT, baseSha: input.baseSha },
            );
            return { id: poll.id, run: closed.run };
          });
        }),

      reopenPoll: (
        _parent: unknown,
        { input }: { input: { poll: string; baseSha: string } },
        ctx: GraphQLCtx,
      ) =>
        api.run(async () =>
          written(ctx, () => {
            const poll = pollToWrite(ctx, input.poll);
            const reopened = reopenPoll(core, ctx.ws, poll, { ...COMMIT, baseSha: input.baseSha });
            return { id: poll.id, run: reopened.run, late: reopened.late };
          }),
        ),
    },
  });
}
