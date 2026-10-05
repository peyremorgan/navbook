/**
 * The bridge: from what the tracker says now to what Discord shows.
 *
 * Told whenever the clone may have moved (`host.onSync`), it runs once at a
 * time, and does nothing when no ref has. Otherwise it reads every record as
 * the tracker has it — the served branch's issues and settled pull requests,
 * and each open pull request from the branch it lives on — compares each with
 * how it last saw it, and tells the threads: a new one where a rule says so,
 * and in the threads that exist, the card redrawn and a message per event.
 *
 * What it last saw is updated record by record, once that record's thread has
 * been told. A record whose telling failed in a way Discord may recover from
 * is told again on the next run, from the same starting point; a refusal that
 * would only be repeated (a permission the bot lacks) is reported and passed.
 */

import { createHash } from "node:crypto";
import type { CoreExtensions, EntityRecord, ReviewPolicy } from "@navbook/core";
import type { ServerPluginHost } from "@navbook/server/plugin";
import type { IssueRule, Settings } from "../core/settings.ts";
import { PLUGIN_NAME, parseSettings, peopleOf } from "../core/settings.ts";
import { DiscordError, type DiscordRest } from "./discord/rest.ts";
import type { MessageBody } from "./discord/types.ts";
import {
  type Core,
  diffSeen,
  type EntityEvent,
  firstSighting,
  type Seen,
  seenOf,
} from "./model.ts";
import { card, messageFor, type RenderContext, tagIds, tagNames, threadName } from "./render.ts";
import { type CompiledRule, compileRules, openingFor, watchedFields } from "./rules.ts";
import type { BridgeState, StateFile, ThreadRef } from "./state.ts";
import { isGone, RENAME_SPACING_MS, Threads } from "./threads.ts";

/** Every record as the tracker has it now, and what is needed to judge them. */
export interface View {
  records: Map<string, EntityRecord>;
  policy: ReviewPolicy;
  /** The plugin's block in the marker, as the served branch has it. */
  settings: unknown;
  ext: CoreExtensions;
  /** The name the tree gives each address it records, for acting as that person. */
  names: Map<string, string>;
}

export interface BridgeOptions {
  host: ServerPluginHost;
  settings: Settings;
  rest: DiscordRest;
  state: StateFile;
  /** How long after a run that could not finish to try again. */
  retryMs?: number;
}

export class Bridge {
  settings: Settings;
  /** The latest view, for commands that need a record without reading the tree again. */
  view: View | null = null;
  readonly threads: Threads;
  private readonly host: ServerPluginHost;
  private readonly core: Core;
  private readonly file: StateFile;
  private state: BridgeState;
  /** The rules as last compiled, against the extensions and settings they were compiled with. */
  private compiled: { ext: CoreExtensions; settings: Settings; rules: CompiledRule[] } | null =
    null;
  private watched = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();
  private running = false;
  private dirty = false;
  private forced = true;
  private stopped = false;
  private lastRefs: string | null = null;
  private retry: NodeJS.Timeout | null = null;
  private readonly retryMs: number;
  /** What was last said about each recurring fault, so the log says it once. */
  private readonly said = new Map<string, string>();

  constructor(opts: BridgeOptions) {
    this.host = opts.host;
    this.core = opts.host.core;
    this.settings = opts.settings;
    this.file = opts.state;
    this.state = opts.state.load();
    this.threads = new Threads(opts.rest);
    this.retryMs = opts.retryMs ?? 60_000;
    this.useSettings(opts.settings);
  }

  /** The Discord accounts the settings link, to the addresses they act as. */
  get people(): Map<string, string> {
    return this.settings.people;
  }

  /** The thread a record has, if any. */
  threadOf(id: string): ThreadRef | undefined {
    return this.state.threads[id];
  }

  /** The record a thread is about, if the bridge made it. */
  recordOfChannel(channel: string | undefined): string | null {
    if (channel === undefined) return null;
    for (const [id, thread] of Object.entries(this.state.threads)) {
      if (thread.thread === channel) return id;
    }
    return null;
  }

  /** Forget a thread Discord says was deleted. */
  forget(thread: string): void {
    for (const [id, held] of Object.entries(this.state.threads)) {
      if (held.thread === thread) delete this.state.threads[id];
    }
  }

  /** The records with a thread whose id starts with `prefix`. */
  threaded(prefix: string): string[] {
    return Object.keys(this.state.threads).filter((id) => id.startsWith(prefix));
  }

  /** Where a record's thread is, as a link anybody in the server can follow. */
  threadUrl(id: string): string | null {
    const thread = this.state.threads[id];
    return thread === undefined
      ? null
      : `https://discord.com/channels/${this.settings.guild}/${thread.thread}`;
  }

  /** Something may have moved: run, now or after the run under way. */
  notify(): void {
    if (this.stopped) return;
    this.dirty = true;
    if (this.running) return;
    this.running = true;
    void this.enqueue(async () => {
      while (this.dirty && !this.stopped) {
        this.dirty = false;
        await this.runOnce();
      }
    }).finally(() => {
      this.running = false;
      if (this.dirty && !this.stopped) this.notify();
    });
  }

  /** Resolves once nothing is running or waiting to; for tests and for shutdown. */
  async idle(): Promise<void> {
    while (this.running || this.dirty) await this.queue.catch(() => undefined);
    await this.queue.catch(() => undefined);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retry !== null) clearTimeout(this.retry);
    this.retry = null;
    await this.queue.catch(() => undefined);
    this.file.save(this.state);
  }

  /**
   * Give a record a thread now, as `/nav thread` asks: in the channel its kind
   * goes to — the pull requests' channel, or the first rule whose scope and
   * query the issue is in — whatever the rules' triggers say.
   */
  openOnRequest(
    id: string,
  ): Promise<{ thread: ThreadRef; created: boolean } | { refused: string }> {
    return this.enqueue(async () => {
      const held = this.state.threads[id];
      if (held !== undefined) return { thread: held, created: false };
      const view = await this.readView();
      const record = view.records.get(id);
      if (record === undefined) return { refused: `#${id} is not an issue or pull request here` };
      const channel = this.channelFor(record, view);
      if (channel === null) {
        return {
          refused:
            record.kind === "pr"
              ? "no channel takes pull requests: the settings name no `prs` channel"
              : "no rule takes this issue: none of the `issues` rules has it in its scope and query",
        };
      }
      const thread = await this.open(record, channel, view);
      this.state.threads[id] = thread;
      this.file.save(this.state);
      return { thread, created: true };
    });
  }

  private channelFor(record: EntityRecord, view: View): string | null {
    if (record.kind === "pr") return this.settings.prs?.channel ?? null;
    const fits = (rule: IssueRule, query: CompiledRule["query"]): boolean =>
      (rule.scope !== "root" || this.core.readParent(record.fm) === null) &&
      this.core.matchesQuery(query, record, view.policy, view.ext);
    return (
      this.rulesFor(view.ext).find(({ rule, query }) => fits(rule, query))?.rule.channel ?? null
    );
  }

  /**
   * The rules with their queries parsed — against the tree's extensions, so a
   * term a plugin registers, like `feature:`, reads as that term. Parsed again
   * only when the settings or the extensions change.
   */
  private rulesFor(ext: CoreExtensions): CompiledRule[] {
    const held = this.compiled;
    if (held !== null && held.ext === ext && held.settings === this.settings) return held.rules;
    const { rules, problems } = compileRules(this.core, this.settings, ext);
    if (problems.length > 0) this.say("rules", `rules ignored: ${problems.join("; ")}`);
    else this.clear("rules");
    this.compiled = { ext, settings: this.settings, rules };
    return rules;
  }

  private enqueue<T>(body: () => Promise<T>): Promise<T> {
    const next = this.queue.then(body, body);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async runOnce(): Promise<void> {
    try {
      const refs = await this.refsDigest();
      if (refs === this.lastRefs && !this.forced) return;
      this.forced = false;
      const view = await this.readView();
      this.view = view;
      this.reloadSettings(view.settings);
      const { failed, waiting } = await this.reconcile(view);
      this.file.save(this.state);
      // A failure is tried again at the next sync as well as on the timer; a
      // rename that waits for Discord's limit only on the timer.
      this.lastRefs = failed ? null : refs;
      this.clear("run");
      if (failed || waiting) this.retryLater();
    } catch (error) {
      this.lastRefs = null;
      this.say("run", `could not bring Discord up to date: ${messageOf(error)}`);
      this.retryLater();
    }
  }

  /** Every branch and remote-tracking branch, and its commit: what a run compares. */
  private async refsDigest(): Promise<string> {
    const refs = await this.core.listRefShasAsync(this.host.config.repoPath, [
      "refs/heads/",
      "refs/remotes/",
    ]);
    return [...refs]
      .map(([ref, sha]) => `${ref} ${sha}`)
      .sort()
      .join("\n");
  }

  /**
   * The tracker as a person browsing it would see it: issues and settled pull
   * requests from the served branch, open pull requests from wherever they
   * live (`listPrsAcrossRefs`, which leaves out a copy its target settled).
   */
  async readView(): Promise<View> {
    const { core } = this;
    const ctx = this.host.api.contextFor();
    return ctx.sync.read(() => {
      const repo = ctx.loadRepo("all");
      const records = new Map<string, EntityRecord>();
      for (const entity of [...repo.issues, ...repo.prs]) {
        if (!records.has(entity.id)) records.set(entity.id, entity);
      }
      for (const found of core.listPrsAcrossRefs(ctx.ws, core.emptyQuery())) {
        const held = records.get(found.entity.id);
        if (held === undefined || held.status === "open")
          records.set(found.entity.id, found.entity);
      }
      const names = new Map<string, string>();
      const note = (value: unknown): void => {
        if (typeof value !== "string") return;
        const person = core.parsePerson(value);
        if (person?.name !== undefined && !names.has(person.email.toLowerCase())) {
          names.set(person.email.toLowerCase(), person.name);
        }
      };
      for (const record of records.values()) {
        note(record.fm.author);
        for (const each of core.readAssignees(record.fm)) note(each);
        for (const each of core.readReviewers(record.fm)) note(each);
        for (const comment of record.comments) note(comment.author);
      }
      return {
        records,
        policy: repo.reviewPolicy.policy,
        settings: repo.plugins.plugins.get(PLUGIN_NAME),
        ext: ctx.ws.ext,
        names,
      };
    });
  }

  /**
   * Tell every thread what changed. `failed` when a record's telling is left
   * to try again; `waiting` when a thread's rename waits for Discord's limit.
   */
  private async reconcile(view: View): Promise<{ failed: boolean; waiting: boolean }> {
    if (this.state.seen === null) {
      // The first look: what is here now is where the bridge starts, and
      // nothing that happened before it is announced.
      this.state.seen = Object.fromEntries(
        [...view.records].map(([id, record]) => [id, seenOf(record)]),
      );
      this.host.report(
        `following ${view.records.size} issues and pull requests; what happens to them from now on is posted`,
      );
      return { failed: false, waiting: false };
    }
    const seen = this.state.seen;
    let failed = false;
    const ids = [...new Set([...Object.keys(seen), ...view.records.keys()])].sort();
    for (const id of ids) {
      if (this.stopped) return { failed: true, waiting: false };
      const before = seen[id];
      const record = view.records.get(id);
      const after = record === undefined ? undefined : seenOf(record);
      const events = diffSeen(this.core, before, after);
      const thread = this.state.threads[id];
      const tidy = thread !== undefined && record !== undefined && this.untidy(thread, record);
      if (events.length === 0 && !tidy) continue;
      try {
        await this.deliver(id, before, record, after, events, view);
      } catch (error) {
        if (isGone(error)) {
          // Deleted in Discord: forgotten, and made again only if a rule fires again.
          delete this.state.threads[id];
          this.host.report(`the thread of #${id} is gone from Discord; it will not be told again`);
        } else if (retryable(error)) {
          failed = true;
          this.say(`record ${id}`, `could not tell the thread of #${id}: ${messageOf(error)}`);
          continue;
        } else {
          this.host.report(
            `Discord refused what #${id} needed, and it is passed over: ${messageOf(error)}`,
          );
        }
      }
      this.clear(`record ${id}`);
      if (after === undefined) delete seen[id];
      else seen[id] = after;
      this.file.save(this.state);
    }
    return { failed, waiting: this.renamesWaiting(view) };
  }

  /** Whether an existing thread's name lags its record's, and may be renamed now. */
  private untidy(thread: ThreadRef, record: EntityRecord): boolean {
    return threadName(record) !== thread.name && Date.now() - thread.renamedAt >= RENAME_SPACING_MS;
  }

  /** Whether some thread's name lags and must wait for Discord's rename limit. */
  private renamesWaiting(view: View): boolean {
    return Object.entries(this.state.threads).some(([id, thread]) => {
      const record = view.records.get(id);
      return record !== undefined && threadName(record) !== thread.name;
    });
  }

  private async deliver(
    id: string,
    before: Seen | undefined,
    record: EntityRecord | undefined,
    after: Seen | undefined,
    events: readonly EntityEvent[],
    view: View,
  ): Promise<void> {
    const ctx = this.renderContext(view);
    let thread = this.state.threads[id];
    if (thread === undefined) {
      if (record === undefined || after === undefined) return;
      const weighed = before === undefined ? firstSighting(this.core, after) : events;
      const opening = openingFor(
        this.core,
        record,
        weighed,
        this.settings,
        this.rulesFor(view.ext),
        view.policy,
        view.ext,
      );
      if (opening === null) return;
      thread = await this.open(record, opening.channel, view);
      this.state.threads[id] = thread;
      // Saved before anything else is posted: a thread made twice is the one
      // mistake a run tried again could not take back.
      this.file.save(this.state);
      // The card names who is asked for something; only a message notifies them.
      const told = before === undefined ? asked(this.core, record) : events;
      await this.post(thread, ctx, record, after, told);
      return;
    }

    if (record === undefined || after === undefined) {
      await this.post(thread, ctx, null, before as Seen, events);
      if (!thread.archived) await this.threads.patch(thread, { archived: true });
      return;
    }

    const body = card(ctx, record);
    const drawn = hashOf(body);
    const settled = record.status !== "open";
    const fresh = events.filter(
      (event) => !(event.type === "comment" && this.state.mirrored.includes(event.id)),
    );
    const bodies = fresh.flatMap((event) => {
      const message = messageFor(ctx, record, after, event, this.watched);
      return message === null ? [] : [{ event, message }];
    });
    // A forum post's card is inside the thread, and an archived thread's
    // messages cannot be edited: open it first, as posting would anyway.
    if (
      thread.archived &&
      (bodies.length > 0 || !settled || (drawn !== thread.card && thread.forum))
    ) {
      await this.threads.patch(thread, { archived: false });
    }
    if (drawn !== thread.card) {
      await this.threads.editCard(thread, body);
      thread.card = drawn;
    }
    for (const { event, message } of bodies) {
      await this.threads.post(thread, message);
      if (event.type === "comment") this.state.mirrored.push(event.id);
    }

    const change: { name?: string; applied_tags?: string[]; archived?: boolean } = {};
    const name = threadName(record);
    if (name !== thread.name && Date.now() - thread.renamedAt >= RENAME_SPACING_MS) {
      change.name = name;
    }
    if (thread.forum) {
      const channel = await this.threads.channel(thread.parent);
      const tags = tagIds(tagNames(this.core, record), channel.available_tags ?? []);
      if (!sameSet(tags, thread.tags)) change.applied_tags = tags;
    }
    if (settled && !thread.archived) change.archived = true;
    await this.threads.patch(thread, change);
  }

  /** Post a message per event, remembering the comments posted. */
  private async post(
    thread: ThreadRef,
    ctx: RenderContext,
    record: EntityRecord | null,
    last: Seen,
    events: readonly EntityEvent[],
  ): Promise<void> {
    for (const event of events) {
      if (event.type === "comment" && this.state.mirrored.includes(event.id)) continue;
      const message = messageFor(ctx, record, last, event, this.watched);
      if (message === null) continue;
      await this.threads.post(thread, message);
      if (event.type === "comment") this.state.mirrored.push(event.id);
    }
  }

  /** Start a record's thread in `channel`, with its card drawn. */
  private async open(record: EntityRecord, channel: string, view: View): Promise<ThreadRef> {
    const body = card(this.renderContext(view), record);
    const thread = await this.threads.open(channel, threadName(record), body, (available) =>
      tagIds(tagNames(this.core, record), available ?? []),
    );
    thread.card = hashOf(body);
    return thread;
  }

  renderContext(view: View): RenderContext {
    const byAddress = new Map<string, string>();
    for (const [user, email] of this.settings.people) {
      const key = email.toLowerCase();
      if (!byAddress.has(key)) byAddress.set(key, user);
    }
    return {
      core: this.core,
      url: this.settings.url,
      discordOf: (address) => byAddress.get(address.toLowerCase()) ?? null,
      policy: view.policy,
    };
  }

  /**
   * The settings as the served branch has them now. A link committed from a
   * terminal takes effect at the next run, as does a rule. A block that no
   * longer reads keeps the rules the bridge had, takes the people that still
   * read, and says what is wrong once; the guild is the one setting a running
   * bridge cannot move to, since its commands are registered there.
   */
  private reloadSettings(raw: unknown): void {
    const reading = parseSettings(raw ?? {}, this.core);
    if (!reading.ok) {
      this.settings = { ...this.settings, people: peopleOf(raw, this.core).people };
      this.say(
        "settings",
        `the settings in navbook.json no longer read: ${reading.problems.join("; ")}`,
      );
      return;
    }
    this.clear("settings");
    if (reading.settings.guild !== this.settings.guild) {
      this.say("guild", "the settings name another guild; restart the server to serve it");
      reading.settings.guild = this.settings.guild;
    }
    this.useSettings(reading.settings);
  }

  private useSettings(settings: Settings): void {
    this.settings = settings;
    this.watched = watchedFields(settings);
  }

  private retryLater(): void {
    if (this.retry !== null || this.stopped) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      this.forced = true;
      this.notify();
    }, this.retryMs);
    this.retry.unref();
  }

  /** Report a recurring fault once, until it changes or is cleared. */
  private say(key: string, line: string): void {
    if (this.said.get(key) === line) return;
    this.said.set(key, line);
    this.host.report(line);
  }

  private clear(key: string): void {
    this.said.delete(key);
  }
}

/** The people a new thread notifies: whoever the record already asks for something. */
function asked(core: Core, record: EntityRecord): EntityEvent[] {
  const events: EntityEvent[] = [];
  const assignees = core.readAssignees(record.fm);
  if (assignees.length > 0) events.push({ type: "assigned", added: assignees, removed: [] });
  if (record.kind === "pr") {
    const reviewers = core.readReviewers(record.fm);
    if (reviewers.length > 0) events.push({ type: "reviewers", added: reviewers, removed: [] });
  }
  return events;
}

/** Whether a failure is one Discord may get over: a limit, its own fault, or no answer at all. */
function retryable(error: unknown): boolean {
  if (!(error instanceof DiscordError)) return true;
  return error.status === 429 || error.status >= 500;
}

function hashOf(body: MessageBody): string {
  return createHash("sha1").update(JSON.stringify(body)).digest("hex");
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
