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
import { type BallotReading, ballotOf, prefill, voterState } from "../core/ballot.ts";
import type { Answer, Answers, DraftQuestion, PollChanges, Results } from "../core/files.ts";
import { useCore } from "../core/files.ts";
import { POLL_STATES } from "../core/index.ts";
import { castVote, closePoll, editPoll, openPoll, reopenPoll, resolvePoll } from "../core/ops.ts";
import { allPolls, type PollRecord, pollsOf, type VoteRecord } from "../core/tree.ts";

const COMMIT = { commit: true } as const;

/** A state as the SDL's enums spell it. */
const toEnum = (state: string): string => state.toUpperCase();

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
   * A poll to write to: in the served tree, and on an issue this server can
   * write to — which the host's own `writeTarget` says, as for a comment.
   */
  function pollToWrite(ctx: GraphQLCtx, ref: string): PollRecord {
    const poll = resolvePoll(core, allPolls(ctx.loadRepo("none")), ref);
    api.writeTarget(ctx, "issue", poll.issue.id);
    return poll;
  }

  /** The poll as a write has just left it, read back inside the transaction, and its issue. */
  function after(ctx: GraphQLCtx, id: string): { poll: PollRecord; issue: EntityRecord } {
    ctx.invalidateRepo();
    const repo = ctx.loadRepo("none");
    const poll = resolvePoll(core, allPolls(repo), id);
    const issue = repo.issues.find((candidate) => candidate.id === poll.issue.id) as EntityRecord;
    return { poll, issue };
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

  // The fields this plugin's SDL adds to `IssueFilter`, onto the query terms
  // the core half registered. Checked here, because a filter never passes
  // through the terms' own parsers.
  host.entityInput({
    filterTerms: (filter): Record<string, string[]> => {
      const terms: Record<string, string[]> = {};
      const states = filter.polls;
      if (Array.isArray(states) && states.length > 0) {
        terms.poll = states.map((value) => {
          const word = String(value).toLowerCase();
          if (!(POLL_STATES as readonly string[]).includes(word))
            throw api.invalidInput(
              `'${word}' is not a poll state; expected one of ${POLL_STATES.join(", ")}`,
            );
          return word;
        });
      }
      const people = filter.pollAwaiting;
      if (Array.isArray(people) && people.length > 0) {
        terms["poll-awaiting"] = people.map((value) => {
          const person = core.parsePerson(String(value));
          if (person === null) throw api.invalidInput(`'${String(value)}' is not an address`);
          return person.email.toLowerCase();
        });
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

  const readingOf = (poll: PollRecord, vote: VoteRecord): BallotReading<VoteRecord> | undefined =>
    poll.ballots.find((reading) => reading.vote === vote);

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
        (await ctx.repo()).issues.find((issue) => issue.id === poll.issue.id),
      path: (poll: PollRecord, _args: unknown, ctx: GraphQLCtx) =>
        `${ctx.ws.navDir}/${poll.dirPath}`,
      baseSha: (poll: PollRecord) => poll.blobSha,
      results: (poll: PollRecord) => toEnum(poll.results),
      status: (poll: PollRecord) => toEnum(poll.status),
      outcome: (poll: PollRecord) => answerList(poll.outcome),
      proposed: (poll: PollRecord) => answerList(poll.proposed),
      votes: (poll: PollRecord) => poll.votes.map((vote) => ({ poll, vote })),
      myState: (poll: PollRecord, _args: unknown, ctx: GraphQLCtx) =>
        toEnum(voterState(poll.ballots, viewer(ctx))),
      myBallot: (poll: PollRecord, _args: unknown, ctx: GraphQLCtx) => {
        const mine = ballotOf(poll.ballots, viewer(ctx));
        return mine === undefined ? null : { poll, vote: mine.vote };
      },
      myDraft: (poll: PollRecord, _args: unknown, ctx: GraphQLCtx) => {
        const draft = prefill(poll.questions, poll.ballots, viewer(ctx));
        return { answers: answerList(draft.answers), note: draft.note ?? "" };
      },
      problems: (poll: PollRecord) => poll.problems.map((problem) => problem.message),
    },

    PollVote: {
      id: ({ vote }: { vote: VoteRecord }) => vote.id,
      path: ({ vote }: { vote: VoteRecord }, _args: unknown, ctx: GraphQLCtx) =>
        `${ctx.ws.navDir}/${vote.path}`,
      author: ({ vote }: { vote: VoteRecord }) => vote.author,
      cast: ({ vote }: { vote: VoteRecord }) => vote.cast,
      state: ({ poll, vote }: { poll: PollRecord; vote: VoteRecord }) =>
        toEnum(readingOf(poll, vote)?.state ?? "invalid"),
      answers: ({ vote }: { vote: VoteRecord }) => answerList(vote.answers),
      note: ({ vote }: { vote: VoteRecord }) => vote.note,
      problems: ({ vote }: { vote: VoteRecord }) => vote.problems.map((problem) => problem.message),
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
            const cast = castVote(
              core,
              ctx.ws,
              poll,
              { answers, note: input.note ?? "" },
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
