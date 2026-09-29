/**
 * `nav test <verb>` — test plans and their runs, at a terminal.
 *
 * Every write goes through the operations in `../core/ops.ts`, the same ones
 * the API calls; this module gathers input, asks questions, and renders. The
 * one thing it adds is the walk: `nav test run` asks about each step in turn
 * and records every answer as it is given.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CliPluginHost } from "@navbook/cli/plugin";
import type { EntityRecord, Repo, RunPlanResult } from "@navbook/core";
import { newPlanFile, useCore, validatePlan } from "../core/files.ts";
import { planJson, runJson } from "../core/json.ts";
import {
  applyPlanEdit,
  attachToRun,
  createPlan,
  findRun as findRunAnywhere,
  loadTree,
  outcomeAt,
  resolvePlan,
  resolveRun,
  revalidatePlanFile,
  runsElsewhere,
  saveRun,
  startRun,
  stepsAtRun,
  testedCommit,
} from "../core/ops.ts";
import {
  latestHead,
  OUTCOMES,
  type Outcome,
  runOutcome,
  TESTED,
  testedOf,
} from "../core/outcome.ts";
import { isStatus, type PlanStep, STATUSES } from "../core/steps.ts";
import {
  allRuns,
  type PlanRecord,
  prRunsOf,
  type RunRecord,
  runsOfPlan,
  testsOf,
} from "../core/tree.ts";
import { type Answer, type WalkEnd, walkSteps } from "./interactive.ts";
import {
  label,
  paintState,
  personName,
  planHeader,
  RUN_COLUMNS,
  renderResults,
  renderSteps,
  runRow,
  tested,
} from "./render.ts";

/** What an editor opens on for a new plan: the grammar, shown by example. */
const SKELETON = `<!-- What this plan covers, and what the tester needs before starting. -->

### The first step

#### Actions

<!-- What the tester does. -->

#### Expected

<!-- What they should see. Leave this section out for a step that checks nothing. -->
`;

export function activate(host: CliPluginHost): void {
  const { core, ctx, ui } = host;
  useCore(core);
  const c = ctx.colors;
  const write = (text: string): void => void ctx.stdout.write(text);

  /** A run's outcome (§6), its step count from the run, else the plan it followed. */
  const outcomeOf = (repo: Repo, run: RunRecord): Outcome =>
    outcomeAt(core, ctx, run, testsOf(repo).planBySlug.get(run.plan));

  /* ------------------------------------------------------------------ open */

  host.command("test open", ([title], opts) => {
    if ((title ?? "").trim() === "") ui.fail("a test plan needs a title");
    const { created } = core.prepareOpen(ctx);
    const author = core.currentAuthor(ctx);
    const composed = ui.composeFile({
      ...(opts.message === undefined ? {} : { message: String(opts.message) }),
      bufferName: "NAVBOOK_TEST_PLAN.md",
      noun: "test plan",
      allowEmptyBody: true,
      render: (body) =>
        newPlanFile({
          title: title as string,
          author,
          created,
          body: opts.message === undefined && body === "" ? SKELETON : body,
        }),
      validate: validatePlan,
    });
    const created_ = createPlan(
      core,
      ctx,
      {
        content: composed.content,
        ...(opts.slug === undefined ? {} : { slug: String(opts.slug) }),
        fallbackTitle: title as string,
      },
      { commit: opts.commit === true },
    );
    write(`Created ${ctx.navDir}/${created_.dirPath}/  (${created_.slug})\n`);
    if (opts.commit) write(`${ui.commitReport(created_.run)}\n`);
  });

  /* ------------------------------------------------------------------ list */

  host.command("test list", ([words], opts) => {
    const repo = loadTree(core, ctx);
    const wanted = ((words as unknown as string[] | undefined) ?? []).map((word) =>
      word.toLowerCase(),
    );
    const plans = testsOf(repo).plans.filter((plan) =>
      wanted.every((word) => plan.slug.includes(word) || plan.title.toLowerCase().includes(word)),
    );
    const summary = (plan: PlanRecord) => {
      const runs = runsOfPlan(repo, plan.slug);
      const last = runs[runs.length - 1];
      return {
        count: runs.length,
        latest: last === undefined ? null : { id: last.id, outcome: outcomeOf(repo, last) },
      };
    };

    if (opts.json) {
      if (plans.length > 0)
        write(`${core.toNdjson(plans.map((plan) => planJson(ctx.navDir, plan, summary(plan))))}\n`);
      return;
    }
    if (plans.length === 0) {
      write(testsOf(repo).plans.length === 0 ? "No test plans yet.\n" : "No test plan matches.\n");
      return;
    }
    const rows = plans.map((plan) => {
      const { count, latest } = summary(plan);
      return [
        plan.slug,
        plan.title,
        String(plan.steps.length),
        String(count),
        latest?.outcome ?? "-",
      ];
    });
    write(
      `${ui.renderTable(
        [
          { header: "slug" },
          { header: "title", flexible: true, minWidth: 20 },
          { header: "steps" },
          { header: "runs" },
          { header: "latest" },
        ],
        rows,
      )}\n`,
    );
  });

  /* ------------------------------------------------------------------ show */

  host.command("test show", ([ref], opts) => {
    const limit = opts.runs === undefined ? 5 : Number(opts.runs);
    if (!Number.isInteger(limit) || limit < 0) ui.fail("--runs takes a whole number of runs");
    const repo = loadTree(core, ctx);
    const plan = testsOf(repo).planBySlug.get(ref as string);
    if (plan !== undefined) showPlan(repo, plan, limit, opts.json === true);
    else showRun(repo, ref as string, opts.json === true);
  });

  function showPlan(repo: Repo, plan: PlanRecord, limit: number, json: boolean): void {
    const runs = runsOfPlan(repo, plan.slug);
    if (json) {
      const last = runs[runs.length - 1];
      const object = planJson(ctx.navDir, plan, {
        count: runs.length,
        latest: last === undefined ? null : { id: last.id, outcome: outcomeOf(repo, last) },
      });
      object.recent = [...runs]
        .reverse()
        .slice(0, limit)
        .map((run) => runJson(ctx.navDir, run, outcomeOf(repo, run)));
      write(`${JSON.stringify(object)}\n`);
      return;
    }
    const lines = planHeader(ctx.navDir, plan, c);
    if (plan.description !== "") lines.push("", plan.description);
    lines.push("", c.dim(`steps (${plan.steps.length}):`));
    if (plan.steps.length === 0) lines.push(c.dim("  none yet"));
    lines.push(...renderSteps(plan.steps, c).map((line) => (line === "" ? line : `  ${line}`)));
    if (limit > 0) {
      const recent = [...runs].reverse().slice(0, limit);
      lines.push("", c.dim(`recent runs (${recent.length} of ${runs.length}):`));
      if (recent.length === 0) lines.push(c.dim("  none"));
      for (const run of recent) lines.push(`  ${runLine(repo, run)}`);
    }
    write(`${lines.join("\n")}\n`);
  }

  /** What a front end says when the plan a run followed is not to be had (§6). */
  function fellBack(run: RunRecord): string {
    return `nav: the plan this run followed (${run.planSha?.slice(0, 12) ?? "no plan-sha"}) is not in this repository; its steps are shown as the plan has them now`;
  }

  function showRun(repo: Repo, ref: string, json: boolean): void {
    const run = findRun(repo, ref);
    const plan = testsOf(repo).planBySlug.get(run.plan);
    const { steps, source } = stepsAtRun(core, ctx, run, plan);
    if (source === "tree") {
      ctx.stderr.write(`${fellBack(run)}\n`);
    } else if (source === "none") {
      ctx.stderr.write(
        `nav: no test plan '${run.plan}' in this tree; showing only what the run recorded\n`,
      );
    }
    const outcome = runOutcome(run, steps?.length ?? null);
    if (json) {
      write(`${JSON.stringify(runJson(ctx.navDir, run, outcome, steps))}\n`);
      return;
    }
    const lines = [`${c.bold(`${run.id}`)}  ${run.plan}  ${paintState(outcome, c)}`, ""];
    lines.push(
      `${label("plan", c)}${plan === undefined ? run.plan : `${plan.title} (${plan.slug})`}`,
    );
    if (run.pr !== null) lines.push(`${label("pull request", c)}#${run.pr.id}`);
    lines.push(`${label("tester", c)}${run.author}`);
    lines.push(`${label("started", c)}${run.started}`);
    lines.push(`${label("finished", c)}${run.finished ?? c.dim("not yet")}`);
    if (run.commit !== null) lines.push(`${label("commit", c)}${run.commit}`);
    if (run.version !== null) lines.push(`${label("version", c)}${run.version}`);
    if (run.environment !== null) lines.push(`${label("environment", c)}${run.environment}`);
    lines.push(`${label("path", c)}${ctx.navDir}/${run.path}`);
    if (run.notes !== "") lines.push("", run.notes);
    lines.push(
      "",
      c.dim(`steps (${run.records.length} of ${steps?.length ?? run.steps ?? "?"} recorded):`),
    );
    lines.push(
      ...renderResults(steps, run.records, c).map((line) => (line === "" ? line : `  ${line}`)),
    );
    if (run.attachments.length > 0) {
      lines.push("", c.dim(`attachments (${run.attachments.length}):`));
      for (const path of run.attachments) lines.push(`  ${ctx.navDir}/${path}`);
    }
    write(`${lines.join("\n")}\n`);
  }

  /**
   * A run by reference, here or in a pull request on another fetched branch,
   * saying where when it is not here; and naming the plans when nothing
   * matches, since a mistyped slug is the likelier mistake.
   */
  function findRun(repo: Repo, ref: string): RunRecord {
    try {
      const found = findRunAnywhere(core, ctx, repo, ref);
      if (found.refs !== null)
        ctx.stderr.write(
          `nav: #${found.run.pr?.id} is not in this tree; read from ${found.refs.join(", ")}\n`,
        );
      return found.run;
    } catch (error) {
      const notFound = error instanceof core.WorkspaceError && error.code === "not-found";
      if (notFound && testsOf(repo).plans.length > 0 && !core.isId(ref.replace(/^#/, ""))) {
        ui.fail(
          `no test plan or run matches '${ref}'`,
          testsOf(repo).plans.map((plan) => `  ${plan.slug}`),
        );
      }
      throw error;
    }
  }

  /** One run, on one line: ID, outcome, when, who, where, against what. */
  function runLine(repo: Repo, run: RunRecord): string {
    const outcome = outcomeOf(repo, run);
    const where = run.pr === null ? "" : `  #${run.pr.id}`;
    return `${run.id}  ${ui.pad(paintState(outcome, c), 11)}  ${run.started}  ${personName(run.author)}${where}  ${tested(run)}`;
  }

  /* ------------------------------------------------------------------ edit */

  host.command("test edit", ([slug], opts) => {
    const plan = resolvePlan(core, loadTree(core, ctx), slug as string);
    const path = core.absPath(ctx, plan.filePath);
    ui.editFile(path);
    const problems = revalidatePlanFile(core, path);
    if (problems.length > 0) {
      ui.fail(
        `${ctx.navDir}/${plan.filePath} is no longer valid; it was left as you saved it`,
        problems.map((problem) => `  ${problem}`),
      );
    }
    const run = applyPlanEdit(core, ctx, plan, { commit: opts.commit === true });
    write(`Edited ${ctx.navDir}/${plan.filePath}\n`);
    if (opts.commit) write(`${ui.commitReport(run)}\n`);
  });

  /* ------------------------------------------------------------------- run */

  host.command("test run", ([slug], opts) => {
    const repo = loadTree(core, ctx);
    const plan = resolvePlan(core, repo, slug as string);
    let pr: EntityRecord | null = null;
    if (opts.pr !== undefined) {
      const target = core.locatePrToWrite(ctx, String(opts.pr));
      if (target.elsewhere !== null) core.refusePrWrite(target.entity, target.elsewhere);
      pr = target.entity;
    }
    const version = opts.version === undefined ? null : String(opts.version);
    const commit = testedCommit(core, ctx, {
      at: opts.at === undefined ? null : String(opts.at),
      pr,
      version,
    });

    const interactive =
      opts.interactive === undefined ? ui.isInteractive() : opts.interactive === true;
    const commitNow = opts.commit === true && !interactive;
    const started = startRun(
      core,
      ctx,
      { plan, pr, commit, version, environment: opts.env === undefined ? null : String(opts.env) },
      { commit: commitNow },
    );
    write(`Started run ${started.id} of '${plan.slug}'  ${ctx.navDir}/${started.path}\n`);
    if (!interactive) {
      if (commitNow) write(`${ui.commitReport(started.run)}\n`);
      else
        write(
          `Record its steps with 'nav test record ${started.id} <step> <status>', or walk them with 'nav test resume ${started.id}'\n`,
        );
      return;
    }
    walk(started.id, "run", opts.commit === true);
  });

  /* --------------------------------------------------------------- resume */

  host.command("test resume", ([ref], opts) => {
    const run = resolveRun(core, allRuns(loadTree(core, ctx)), ref as string);
    if (run.finished !== null)
      ui.fail(`test run ${run.id} is finished; nothing more can be recorded`);
    walk(run.id, "record", opts.commit === true);
  });

  /**
   * Walk the unrecorded steps of a run, writing each answer to the file as it
   * is given, then commit once when asked to. `action` names that commit: a
   * session that started the run is a `run`, one that continued it records.
   */
  function walk(id: string, action: "run" | "record", commit: boolean): void {
    const current = (): {
      run: RunRecord;
      steps: readonly PlanStep[];
      source: "plan-sha" | "tree";
    } => {
      const repo = loadTree(core, ctx);
      const run = resolveRun(core, allRuns(repo), id);
      const { steps, source } = stepsAtRun(core, ctx, run, testsOf(repo).planBySlug.get(run.plan));
      if (steps === null || source === "none")
        return ui.fail(`no test plan '${run.plan}' to walk through`);
      // Never past the steps the run followed, whatever the plan has now.
      return { run, steps: steps.slice(0, run.steps ?? steps.length), source };
    };
    const { run, steps, source } = current();
    if (source === "tree") ctx.stderr.write(`${fellBack(run)}\n`);
    const recorded = new Set(run.records.map((record) => record.number));
    const pending = steps.map((step) => step.number).filter((number) => !recorded.has(number));
    write(
      `${c.bold(run.plan)}: ${steps.length} step${steps.length === 1 ? "" : "s"}, ${pending.length} to go, against ${tested(run)}\n`,
    );

    const end: WalkEnd = walkSteps(
      {
        write,
        ask: (question) => ui.ask(question),
        edit: (initial) => ui.editText("NAVBOOK_TEST_ACTUAL.md", initial),
      },
      steps,
      pending,
      (answer: Answer) => {
        const now = current();
        try {
          saveRun(
            core,
            ctx,
            now.run,
            now.steps,
            { results: [answer] },
            { baseSha: now.run.blobSha },
          );
          return null;
        } catch (error) {
          if (error instanceof core.WorkspaceError && error.code === "invalid-input")
            return `nav: ${error.message}`;
          throw error;
        }
      },
    );

    let result: RunPlanResult | null = null;
    if (end === "finished" || commit) {
      const now = current();
      result = saveRun(
        core,
        ctx,
        now.run,
        now.steps,
        { finish: end === "finished" },
        { commit, action: action === "run" ? "run" : end === "finished" ? "finish" : "record" },
      );
    }
    const after = current().run;
    write(
      `\n${after.records.length} of ${steps.length} steps recorded: ${paintState(runOutcome(after, steps.length), c)}\n`,
    );
    if (end === "stopped" || end === "complete") {
      write(
        `Left in progress; carry on with 'nav test resume ${id}', or close it with 'nav test finish ${id}'\n`,
      );
    }
    if (commit && result !== null) write(`${ui.commitReport(result)}\n`);
  }

  /* --------------------------------------------------------------- record */

  host.command("test record", ([ref, step, status], opts) => {
    const number = Number(step);
    if (!/^\d+$/.test(String(step)) || !Number.isInteger(number))
      ui.fail(`'${String(step)}' is not a step number`);
    const word = String(status).toLowerCase();
    if (!isStatus(word))
      return ui.fail(`'${String(status)}' is not a status; expected one of ${STATUSES.join(", ")}`);
    const repo = loadTree(core, ctx);
    const run = resolveRun(core, allRuns(repo), ref as string);
    const { steps } = stepsAtRun(core, ctx, run, testsOf(repo).planBySlug.get(run.plan));
    const result = saveRun(
      core,
      ctx,
      run,
      steps,
      {
        results: [
          { number, status: word, actual: opts.actual === undefined ? null : String(opts.actual) },
        ],
      },
      { commit: opts.commit === true },
    );
    write(`Recorded step ${number} of run ${run.id}: ${paintState(word, c)}\n`);
    if (opts.commit) write(`${ui.commitReport(result)}\n`);
  });

  /* --------------------------------------------------------------- finish */

  host.command("test finish", ([ref], opts) => {
    const repo = loadTree(core, ctx);
    const run = resolveRun(core, allRuns(repo), ref as string);
    const { steps } = stepsAtRun(core, ctx, run, testsOf(repo).planBySlug.get(run.plan));
    const result = saveRun(
      core,
      ctx,
      run,
      steps,
      { finish: true },
      { commit: opts.commit === true },
    );
    const after = resolveRun(core, allRuns(loadTree(core, ctx)), run.id);
    write(`Finished run ${run.id}: ${paintState(runOutcome(after, steps?.length ?? null), c)}\n`);
    if (opts.commit) write(`${ui.commitReport(result)}\n`);
  });

  /* ----------------------------------------------------------------- runs */

  host.command("test runs", ([terms], opts) => {
    const query = parseRunTerms((terms as unknown as string[] | undefined) ?? []);
    const repo = loadTree(core, ctx);
    const runs = [
      ...allRuns(repo),
      ...(opts.allRefs ? runsElsewhere(core, ctx, repo).map((entry) => entry.run) : []),
    ]
      .filter((run) => query.plans.length === 0 || query.plans.includes(run.plan))
      .filter((run) => query.prs.every((prefix) => run.pr?.id.startsWith(prefix) === true))
      .map((run) => ({ run, outcome: outcomeOf(repo, run) }))
      .filter(({ outcome }) => query.outcomes.length === 0 || query.outcomes.includes(outcome))
      .sort((a, b) =>
        a.run.fileName < b.run.fileName ? 1 : a.run.fileName > b.run.fileName ? -1 : 0,
      );

    if (opts.json) {
      if (runs.length > 0)
        write(
          `${core.toNdjson(runs.map(({ run, outcome }) => runJson(ctx.navDir, run, outcome)))}\n`,
        );
      return;
    }
    if (runs.length === 0) {
      write("No test runs match.\n");
      return;
    }
    write(
      `${ui.renderTable(
        [...RUN_COLUMNS],
        runs.map(({ run, outcome }) => runRow(run, outcome)),
      )}\n`,
    );
  });

  /** `plan:SLUG` (or a bare slug), `pr:ID` and `outcome:STATE`; repeating plan and outcome ORs. */
  function parseRunTerms(terms: readonly string[]): {
    plans: string[];
    prs: string[];
    outcomes: Outcome[];
  } {
    const query = { plans: [] as string[], prs: [] as string[], outcomes: [] as Outcome[] };
    for (const term of terms) {
      const colon = term.indexOf(":");
      const key = colon === -1 ? "plan" : term.slice(0, colon);
      const value = colon === -1 ? term : term.slice(colon + 1);
      if (value === "") ui.fail(`query term '${term}' is missing a value`);
      if (key === "plan") query.plans.push(value);
      else if (key === "pr") {
        const id = value.replace(/^#/, "").toLowerCase();
        if (id.length < core.MIN_PREFIX_LENGTH)
          ui.fail(
            `'${value}' is too short; ID prefixes must be at least ${core.MIN_PREFIX_LENGTH} characters`,
          );
        query.prs.push(id);
      } else if (key === "outcome") {
        const word = value.toLowerCase();
        if (!(OUTCOMES as readonly string[]).includes(word))
          ui.fail(`unknown outcome '${value}' (expected ${OUTCOMES.join(", ")})`);
        query.outcomes.push(word as Outcome);
      } else ui.fail(`unknown query term '${term}'; 'nav test runs' takes plan:, pr: and outcome:`);
    }
    return query;
  }

  /* --------------------------------------------------------------- attach */

  host.command("test attach", ([ref, files], opts) => {
    const run = resolveRun(core, allRuns(loadTree(core, ctx)), ref as string);
    const step = opts.step === undefined ? undefined : Number(opts.step);
    if (step !== undefined && (!Number.isInteger(step) || step < 1))
      ui.fail("--step takes the number of a recorded step");
    const attachments = ((files as unknown as string[] | undefined) ?? []).map((file) => {
      const path = resolve(ctx.cwd, file);
      try {
        return { name: file, bytes: new Uint8Array(readFileSync(path)) };
      } catch (error) {
        return ui.fail(
          `cannot read ${file}: ${error instanceof Error ? error.message.replace(/^[A-Z]+: /, "") : String(error)}`,
        );
      }
    });
    const attached = attachToRun(core, ctx, run, attachments, {
      commit: opts.commit === true,
      ...(step === undefined ? {} : { step }),
    });
    for (const name of attached.names)
      write(`Attached ${ctx.navDir}/${run.attachmentsDir}/${name}\n`);
    if (opts.commit) write(`${ui.commitReport(attached.run)}\n`);
  });

  /* ---------------------------------------------------- pull requests */

  /**
   * A pull request's runs with their outcomes (§6). The tree is read only when
   * a run lacks `steps`, which a run written by a tool never does.
   */
  function prRuns(entity: EntityRecord): { run: RunRecord; outcome: Outcome }[] {
    let repo: Repo | undefined;
    return prRunsOf(entity).map((run) => {
      if (run.steps !== null) return { run, outcome: runOutcome(run) };
      repo ??= loadTree(core, ctx);
      return { run, outcome: outcomeOf(repo, run) };
    });
  }

  host.contribute("pr show", {
    showSection: (entity) => {
      const runs = prRuns(entity);
      if (runs.length === 0) return [];
      const head = latestHead(entity);
      const lines = [
        c.dim(`test runs (${runs.length}), tested: `) + paintState(testedOf(entity), c),
      ];
      for (const { run, outcome } of [...runs].reverse()) {
        const older =
          run.commit !== null && run.commit !== head ? c.dim("  (an earlier revision)") : "";
        lines.push(
          `  ${run.id}  ${ui.pad(paintState(outcome, c), 11)}  ${run.plan}  ${run.started}  ${personName(run.author)}  ${tested(run)}${older}`,
        );
      }
      return lines;
    },
    jsonExtra: (entity) => ({
      tests: {
        tested: testedOf(entity),
        runs: prRuns(entity).map(({ run, outcome }) => runJson(ctx.navDir, run, outcome)),
      },
    }),
  });

  host.contribute("pr list", { listCompletions: () => TESTED.map((state) => `tested:${state}`) });

  /* ---------------------------------------------------------- completion */

  const quietly = (answer: () => string[]): string[] => {
    try {
      return answer();
    } catch {
      return [];
    }
  };
  const slugs = (): string[] =>
    quietly(() => testsOf(loadTree(core, ctx)).plans.map((plan) => plan.slug));
  const runIds = (): string[] => quietly(() => allRuns(loadTree(core, ctx)).map((run) => run.id));
  host.completer("plan", slugs);
  host.completer("run", runIds);
  host.completer("plan-or-run", () => [...slugs(), ...runIds()]);
  host.completer("status", () => [...STATUSES]);
  host.completer("runs-term", () => [
    ...slugs().map((slug) => `plan:${slug}`),
    ...OUTCOMES.map((outcome) => `outcome:${outcome}`),
  ]);
}
