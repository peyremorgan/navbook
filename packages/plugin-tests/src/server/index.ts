/**
 * Test plans and runs: the API half — `doc/spec.md`, spec 06 §6.3.
 *
 * Reads take the tree through the request's context, as every built-in
 * resolver does; writes go through `ctx.sync.write` and the same operations
 * `nav test` runs, so a plan created in a browser and one created at a
 * terminal are the same file, committed the same way.
 *
 * A run attached to a pull request is written beside its `pr.md`. The served
 * checkout holds one branch, so a pull request that only another branch
 * carries is refused with PRECONDITION and that branch, through the host's own
 * `writeTarget` — exactly the answer a comment on it gets.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import type { EntityRecord } from "@navbook/core";
import type { GraphQLCtx, ServerPluginHost } from "@navbook/server/plugin";
import { mediaType, newPlanFile, useCore, validatePlan } from "../core/files.ts";
import { resultRows } from "../core/json.ts";
import {
  type Attachment,
  attachToRun,
  createPlan,
  editPlan,
  findRun as findRunAnywhere,
  resolvePlan,
  resolveRun,
  saveRun,
  startRun,
  stepsAtRun,
  testedCommit,
} from "../core/ops.ts";
import { type Outcome, runOutcome, TESTED, testedOf } from "../core/outcome.ts";
import {
  type PlanStep,
  planSteps,
  renderPlanBody,
  type StepStatus,
  textFaults,
} from "../core/steps.ts";
import {
  allRuns,
  type PlanRecord,
  prRunsOf,
  type RunRecord,
  runsOfPlan,
  testsOf,
} from "../core/tree.ts";

/** The most one attached file may weigh, decoded: base64 over GraphQL holds it in memory. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** The most one attach request may carry, decoded. */
export const MAX_REQUEST_BYTES = 10 * 1024 * 1024;
/**
 * The largest attachment the API hands back. A run recorded at a terminal can
 * carry anything; served as base64 inside a JSON response it costs a third
 * again, in memory on both ends, so past this it is read from a clone.
 */
export const MAX_SERVED_BYTES = 20 * 1024 * 1024;

const COMMIT = { commit: true } as const;

/** An outcome or tested state as the SDL's enums spell it. */
const toEnum = (state: string): string => state.toUpperCase().replace("-", "_");

/** A status from the SDL's enum, as the format spells it. */
const fromStatus = (value: string): StepStatus => value.toLowerCase() as StepStatus;

interface StepInput {
  title: string;
  actions: string;
  expected?: string | null;
}

export function activate(host: ServerPluginHost): void {
  const { core, api } = host;
  useCore(core);

  /* ------------------------------------------------------------- reading */

  /**
   * The steps a run followed, worked out once per run record: `results`,
   * `outcome` and `stepsFrom` all need them, and finding the plan `plan-sha`
   * names may ask git. A record lives as long as the parse it came from, so the
   * answer is dropped with it when the tree changes; a failure is not kept.
   */
  const followed = new WeakMap<RunRecord, Promise<{ steps: PlanStep[] | null; source: string }>>();
  function stepsOf(
    ctx: GraphQLCtx,
    run: RunRecord,
  ): Promise<{ steps: PlanStep[] | null; source: string }> {
    let found = followed.get(run);
    if (found === undefined) {
      found = (async () => {
        const plan = testsOf(await ctx.repo()).planBySlug.get(run.plan);
        // Under the lock, without a pull: a field sees the tree its parent saw.
        return api.run(() => ctx.sync.locked(() => stepsAtRun(core, ctx.ws, run, plan)));
      })();
      found.catch(() => followed.delete(run));
      followed.set(run, found);
    }
    return found;
  }

  /** A run's outcome, its step count from the run, else the plan it followed. */
  async function outcomeOf(ctx: GraphQLCtx, run: RunRecord): Promise<Outcome> {
    if (run.steps !== null) return runOutcome(run);
    return runOutcome(run, (await stepsOf(ctx, run)).steps?.length ?? null);
  }

  /** A run by reference: in the served tree, else in a pull request on another branch. */
  function findRun(ctx: GraphQLCtx, ref: string): RunRecord {
    return findRunAnywhere(core, ctx.ws, ctx.loadRepo("none"), ref).run;
  }

  /**
   * A run to write to, in the served tree. One that only another branch
   * carries is refused as its pull request would be: PRECONDITION, and the
   * branch to serve instead.
   */
  function runToWrite(ctx: GraphQLCtx, ref: string): RunRecord {
    const run = findRun(ctx, ref);
    if (run.pr !== null) api.writeTarget(ctx, "pr", run.pr.id);
    return run;
  }

  /** The run as a write has just left it, read back inside the transaction. */
  function runAfter(ctx: GraphQLCtx, id: string): RunRecord {
    ctx.invalidateRepo();
    return resolveRun(core, allRuns(ctx.loadRepo("none")), id);
  }

  function planAfter(ctx: GraphQLCtx, slug: string): PlanRecord {
    ctx.invalidateRepo();
    return resolvePlan(core, ctx.loadRepo("none"), slug);
  }

  const text = (fm: Record<string, unknown>, key: string): string =>
    typeof fm[key] === "string" ? (fm[key] as string) : "";

  /* ------------------------------------------------------ host's inputs */

  // The `tested` field this plugin's SDL adds to `PrFilter`, onto the query
  // term the core half registered. Checked here, because a filter never
  // passes through the term's own parser.
  host.entityInput({
    filterTerms: (filter): Record<string, string[]> => {
      const values = filter.tested;
      if (!Array.isArray(values) || values.length === 0) return {};
      const words = values.map((value) => String(value).toLowerCase());
      for (const word of words) {
        if (!(TESTED as readonly string[]).includes(word)) {
          throw api.invalidInput(
            `'${word}' is not a tested state; expected one of ${TESTED.join(", ")}`,
          );
        }
      }
      return { tested: words };
    },
  });

  // What a pull request's row shows: its tested state, from the runs its own
  // record already carries — no read beyond the record.
  host.entityExt((entity: EntityRecord) => {
    if (entity.kind !== "pr") return undefined;
    const runs = prRunsOf(entity);
    const last = runs[runs.length - 1];
    return {
      tested: testedOf(entity),
      runs: runs.length,
      latest: last === undefined ? null : { id: last.id, outcome: runOutcome(last) },
    };
  });

  /* ---------------------------------------------------------- resolvers */

  host.resolvers({
    Query: {
      testPlans: (_parent: unknown, _args: unknown, ctx: GraphQLCtx) =>
        api.run(() => ctx.sync.read(() => testsOf(ctx.loadRepo("none")).plans)),
      testPlan: (_parent: unknown, { slug }: { slug: string }, ctx: GraphQLCtx) =>
        api.run(() => ctx.sync.read(() => resolvePlan(core, ctx.loadRepo("none"), slug))),
      testRun: (_parent: unknown, { id }: { id: string }, ctx: GraphQLCtx) =>
        api.run(() => ctx.sync.read(() => findRun(ctx, id))),
      testAttachment: (_parent: unknown, args: { run: string; name: string }, ctx: GraphQLCtx) =>
        api.run(() =>
          ctx.sync.read(() => {
            const run = findRun(ctx, args.run);
            // By lookup among the files the tree lists beside the run, never by
            // joining the name onto a path: nothing a client sends can reach
            // outside the run's own directory.
            const path = run.attachments.find(
              (candidate) => candidate.split("/").pop() === args.name,
            );
            if (path === undefined) {
              return core.wsFail(
                "not-found",
                `test run ${run.id} has no attachment named '${args.name}'`,
              );
            }
            const bytes = readAttachment(ctx, run, path);
            return {
              name: args.name,
              contentType: mediaType(args.name),
              size: bytes.length,
              base64: bytes.toString("base64"),
            };
          }),
        ),
    },

    Pr: {
      testRuns: ({ entity }: { entity: EntityRecord }) => [...prRunsOf(entity)].reverse(),
      tested: ({ entity }: { entity: EntityRecord }) => toEnum(testedOf(entity)),
    } as never,

    TestPlan: {
      author: (plan: PlanRecord) => text(plan.fm, "author"),
      created: (plan: PlanRecord) => text(plan.fm, "created"),
      path: (plan: PlanRecord, _args: unknown, ctx: GraphQLCtx) =>
        `${ctx.ws.navDir}/${plan.dirPath}`,
      baseSha: (plan: PlanRecord) => plan.blobSha,
      runs: async (plan: PlanRecord, _args: unknown, ctx: GraphQLCtx) =>
        runsOfPlan(await ctx.repo(), plan.slug).reverse(),
      stats: async (plan: PlanRecord, _args: unknown, ctx: GraphQLCtx) => {
        const stats = {
          runs: 0,
          passed: 0,
          failed: 0,
          blocked: 0,
          skipped: 0,
          incomplete: 0,
          inProgress: 0,
        };
        for (const run of runsOfPlan(await ctx.repo(), plan.slug)) {
          stats.runs++;
          const outcome = await outcomeOf(ctx, run);
          stats[outcome === "in-progress" ? "inProgress" : outcome]++;
        }
        return stats;
      },
    },

    TestRun: {
      path: (run: RunRecord, _args: unknown, ctx: GraphQLCtx) => `${ctx.ws.navDir}/${run.path}`,
      planSlug: (run: RunRecord) => run.plan,
      plan: async (run: RunRecord, _args: unknown, ctx: GraphQLCtx) =>
        testsOf(await ctx.repo()).planBySlug.get(run.plan) ?? null,
      outcome: async (run: RunRecord, _args: unknown, ctx: GraphQLCtx) =>
        toEnum(await outcomeOf(ctx, run)),
      results: async (run: RunRecord, _args: unknown, ctx: GraphQLCtx) => {
        const { steps } = await stepsOf(ctx, run);
        return resultRows(steps, run.records).map((row) => ({
          number: row.number,
          title: row.title,
          actions: row.actions ?? "",
          expected: row.expected,
          status: row.record === undefined ? null : toEnum(row.record.status),
          actual: row.record?.actual ?? null,
        }));
      },
      stepsFrom: async (run: RunRecord, _args: unknown, ctx: GraphQLCtx) =>
        toEnum((await stepsOf(ctx, run)).source),
      pr: async (run: RunRecord, _args: unknown, ctx: GraphQLCtx) => {
        if (run.pr === null) return null;
        const id = run.pr.id;
        const here = (await ctx.repo()).prs.find((pr) => pr.id === id);
        if (here !== undefined) return { entity: here, refs: [] };
        const found = await api.run(() =>
          ctx.sync.locked(() => core.scanRefsForOpenPrs(ctx.ws).find((f) => f.entity.id === id)),
        );
        return found === undefined
          ? null
          : { entity: found.entity, refs: found.refs.map((ref) => ref.short) };
      },
      attachments: (run: RunRecord, _args: unknown, ctx: GraphQLCtx) =>
        run.attachments.map((path) => ({
          name: path.split("/").pop(),
          path: `${ctx.ws.navDir}/${path}`,
        })),
      baseSha: (run: RunRecord) => run.blobSha,
    },

    Mutation: {
      createTestPlan: (
        _parent: unknown,
        {
          input,
        }: {
          input: {
            title: string;
            slug?: string | null;
            description?: string | null;
            steps: StepInput[];
          };
        },
        ctx: GraphQLCtx,
      ) =>
        api.run(async () => {
          api.requireText(input.title, "title");
          checkSteps(input.steps);
          checkDescription(input.description);
          const { result, pushed } = await ctx.sync.write(
            () => {
              const content = newPlanFile({
                title: input.title.trim(),
                author: core.currentAuthor(ctx.ws),
                created: core.prepareOpen(ctx.ws).created,
                description: input.description ?? "",
                steps: input.steps,
              });
              api.checkComposed(content, validatePlan, "test plan");
              const created = createPlan(
                core,
                ctx.ws,
                {
                  content,
                  ...(input.slug ? { slug: input.slug } : {}),
                  fallbackTitle: input.title,
                },
                COMMIT,
              );
              return { run: created.run, plan: planAfter(ctx, created.slug) };
            },
            (r) => r.run.committed,
          );
          return { plan: result.plan, commit: api.commitInfo(ctx, result.run, pushed) };
        }),

      updateTestPlan: (
        _parent: unknown,
        {
          input,
        }: {
          input: {
            slug: string;
            title?: string | null;
            description?: string | null;
            steps?: StepInput[] | null;
            baseSha: string;
          };
        },
        ctx: GraphQLCtx,
      ) =>
        api.run(async () => {
          const empty = input.title == null && input.description == null && input.steps == null;
          if (empty) throw api.invalidInput("the patch names no field to change");
          if (input.title != null) api.requireText(input.title, "title");
          if (input.steps != null) checkSteps(input.steps);
          checkDescription(input.description);
          const { result, pushed } = await ctx.sync.write(
            () => {
              const plan = resolvePlan(core, ctx.loadRepo("none"), input.slug);
              const text = readFileSync(core.absPath(ctx.ws, plan.filePath), "utf8");
              // The body is composed from fields, so whatever the grammar could
              // not read — a stray section, text before a step's first one —
              // would be dropped without anyone having seen it (§3.1).
              const faults = planSteps(core.parseFile(text).body).faults;
              if (faults.length > 0) {
                core.wsFail(
                  "precondition",
                  `test plan '${plan.slug}' has text its editor cannot show; fix ${ctx.ws.navDir}/${plan.filePath} by hand, or with 'nav test edit ${plan.slug}'`,
                  faults.map((fault) => fault.message),
                );
              }
              // The file as it is, so a key a later revision of the format adds survives.
              const nav = core.parseDoc(text);
              if (input.title != null) core.patchDoc(nav, { title: input.title.trim() });
              const steps = input.steps ?? plan.steps;
              const description = input.description ?? plan.description;
              nav.body = renderPlanBody(description, steps);
              const content = core.serializeDoc(nav);
              api.checkComposed(content, validatePlan, "test plan");
              const edited = editPlan(core, ctx.ws, plan.slug, content, {
                ...COMMIT,
                baseSha: input.baseSha,
              });
              return { run: edited.run, plan: planAfter(ctx, plan.slug) };
            },
            (r) => r.run.committed,
          );
          return { plan: result.plan, commit: api.commitInfo(ctx, result.run, pushed) };
        }),

      startTestRun: (
        _parent: unknown,
        {
          input,
        }: {
          input: {
            plan: string;
            pr?: string | null;
            commit?: string | null;
            version?: string | null;
            environment?: string | null;
          };
        },
        ctx: GraphQLCtx,
      ) =>
        api.run(async () => {
          const { result, pushed } = await ctx.sync.write(
            () => {
              const plan = resolvePlan(core, ctx.loadRepo("none"), input.plan);
              const pr = input.pr ? api.writeTarget(ctx, "pr", input.pr) : null;
              const version = input.version?.trim() || null;
              const commit = testedCommit(core, ctx.ws, { at: input.commit, pr, version });
              const started = startRun(
                core,
                ctx.ws,
                { plan, pr, commit, version, environment: input.environment?.trim() || null },
                COMMIT,
              );
              return { run: started.run, record: runAfter(ctx, started.id) };
            },
            (r) => r.run.committed,
          );
          return { run: result.record, commit: api.commitInfo(ctx, result.run, pushed) };
        }),

      saveTestRun: (
        _parent: unknown,
        {
          input,
        }: {
          input: {
            id: string;
            results: { number: number; status: string; actual?: string | null }[];
            notes?: string | null;
            finish: boolean;
            baseSha: string;
          };
        },
        ctx: GraphQLCtx,
      ) =>
        api.run(async () => {
          const { result, pushed } = await ctx.sync.write(
            () => {
              const run = runToWrite(ctx, input.id);
              const plan = testsOf(ctx.loadRepo("none")).planBySlug.get(run.plan);
              const { steps } = stepsAtRun(core, ctx.ws, run, plan);
              const saved = saveRun(
                core,
                ctx.ws,
                run,
                steps,
                {
                  results: input.results.map((step) => ({
                    number: step.number,
                    status: fromStatus(step.status),
                    actual: step.actual ?? null,
                  })),
                  ...(input.notes == null ? {} : { notes: input.notes }),
                  finish: input.finish,
                },
                { ...COMMIT, baseSha: input.baseSha },
              );
              return { run: saved, record: runAfter(ctx, run.id) };
            },
            (r) => r.run.committed,
          );
          return { run: result.record, commit: api.commitInfo(ctx, result.run, pushed) };
        }),

      attachToTestRun: (
        _parent: unknown,
        {
          input,
        }: {
          input: {
            id: string;
            files: { name: string; base64: string }[];
            step?: number | null;
            baseSha: string;
          };
        },
        ctx: GraphQLCtx,
      ) =>
        api.run(async () => {
          const files = decodeFiles(input.files);
          const { result, pushed } = await ctx.sync.write(
            () => {
              const run = runToWrite(ctx, input.id);
              const attached = attachToRun(core, ctx.ws, run, files, {
                ...COMMIT,
                baseSha: input.baseSha,
                ...(input.step == null ? {} : { step: input.step }),
              });
              return { run: attached.run, names: attached.names, record: runAfter(ctx, run.id) };
            },
            (r) => r.run.committed,
          );
          return {
            run: result.record,
            names: result.names,
            commit: api.commitInfo(ctx, result.run, pushed),
          };
        }),
    },
  });

  /* ------------------------------------------------------------ helpers */

  /** Refuse steps a plan cannot hold: no title, no actions, or text that would read back as structure. */
  function checkSteps(steps: readonly StepInput[]): void {
    for (const [index, step] of steps.entries()) {
      const where = `step ${index + 1}`;
      if (step.title.trim() === "") throw api.invalidInput(`${where} needs a title`);
      if (/[\r\n]/.test(step.title)) throw api.invalidInput(`${where}'s title must be one line`);
      if (step.actions.trim() === "") throw api.invalidInput(`${where} needs its actions`);
      const faults = [
        ...textFaults(step.actions, `${where}'s actions`, 0),
        ...textFaults(step.expected ?? "", `${where}'s expected result`, 0),
      ];
      if (faults[0] !== undefined) throw api.invalidInput(faults[0].message);
    }
  }

  function checkDescription(description: string | null | undefined): void {
    const fault = textFaults(description ?? "", "the description", 2)[0];
    if (fault !== undefined) throw api.invalidInput(fault.message);
  }

  /** Decode attached files, refusing what is not base64 or weighs too much. */
  function decodeFiles(files: readonly { name: string; base64: string }[]): Attachment[] {
    let total = 0;
    return files.map((file) => {
      const compact = file.base64.replace(/\s+/g, "");
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) {
        throw api.invalidInput(`'${file.name}' is not base64`);
      }
      const bytes = Buffer.from(compact, "base64");
      if (bytes.length > MAX_FILE_BYTES) {
        throw api.invalidInput(`'${file.name}' is larger than ${MAX_FILE_BYTES / 1024 / 1024} MiB`);
      }
      total += bytes.length;
      if (total > MAX_REQUEST_BYTES) {
        throw api.invalidInput(
          `the files together are larger than ${MAX_REQUEST_BYTES / 1024 / 1024} MiB`,
        );
      }
      return { name: file.name, bytes: new Uint8Array(bytes) };
    });
  }

  /**
   * An attachment's bytes: off the working tree for a run the served tree
   * holds, off its branch's blob for one only another branch carries.
   */
  function readAttachment(ctx: GraphQLCtx, run: RunRecord, path: string): Buffer {
    const here = run.pr === null || ctx.loadRepo("none").prs.some((pr) => pr.id === run.pr?.id);
    if (here) {
      const absolute = core.absPath(ctx.ws, path);
      servable(statSync(absolute).size, path);
      return readFileSync(absolute);
    }
    const found = core.scanRefsForOpenPrs(ctx.ws).find((entry) => entry.entity.id === run.pr?.id);
    const ref = found?.refs[0]?.full;
    if (ref === undefined)
      return core.wsFail("not-found", `test run ${run.id}'s pull request is on no fetched branch`);
    const object = `${ref}:${core.repoPath(ctx.ws.navDir, path)}`;
    servable(Number(core.git(["cat-file", "-s", object], { cwd: ctx.ws.repoRoot }).trim()), path);
    // Bytes, not text: the core's git runner decodes UTF-8, which a picture is not.
    return execFileSync("git", ["cat-file", "blob", object], {
      cwd: ctx.ws.repoRoot,
      maxBuffer: MAX_SERVED_BYTES + 1,
    });
  }

  /** Refuse, before reading it, an attachment too large to hand back (see MAX_SERVED_BYTES). */
  function servable(size: number, path: string): void {
    if (size <= MAX_SERVED_BYTES) return;
    core.wsFail(
      "precondition",
      `${path.split("/").pop()} is larger than the ${MAX_SERVED_BYTES / 1024 / 1024} MiB the API serves; read it from a clone`,
    );
  }
}
