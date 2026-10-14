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
import type { Settings } from "../core/settings.ts";
import { PLUGIN_NAME, parseSettings, peopleOf } from "../core/settings.ts";
import { DiscordError, type DiscordRest } from "./discord/rest.ts";
import { type Channel, ChannelType, type MessageBody } from "./discord/types.ts";
import {
  type Core,
  diffSeen,
  type EntityEvent,
  firstSighting,
  type Seen,
  seenOf,
} from "./model.ts";
import { card, messageFor, type RenderContext, tagIds, tagNames, threadName } from "./render.ts";
import { type CompiledRule, channelFor, compileRules, openingFor, watchedFields } from "./rules.ts";
import { type BridgeState, type StateFile, type ThreadRef, TOLD_LIMIT } from "./state.ts";
import { ChannelRefused, isGone, RENAME_SPACING_MS, Threads } from "./threads.ts";

/** The least time between two saves of the state in one run. */
const SAVE_SPACING_MS = 1_000;

/** A message the thread has not been told yet, and the key it is remembered by. */
interface Telling {
  key: string;
  message: MessageBody;
}

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
  /**
   * How long after a run that could not finish to try again, doubled each
   * time it fails again, up to five minutes.
   */
  backoffMs?: number;
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
  /** The keys of every message told, as `state.told` lists them, for asking. */
  private told = new Set<string>();
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
  /** Whether the threads were looked for in Discord, for a bridge that knew of none. */
  private searched = false;
  /** Whether a run has finished since the bridge started. */
  private caughtUp = false;
  private retry: { timer: NodeJS.Timeout; at: number } | null = null;
  private readonly firstBackoffMs: number;
  private backoffMs: number;
  /** What was last said about each recurring fault, so the log says it once. */
  private readonly said = new Map<string, string>();
  private savedAt = 0;

  constructor(opts: BridgeOptions) {
    this.host = opts.host;
    this.core = opts.host.core;
    this.settings = opts.settings;
    this.file = opts.state;
    this.state = opts.state.load();
    this.told = new Set(this.state.told);
    this.threads = new Threads(opts.rest);
    this.firstBackoffMs = opts.backoffMs ?? 5_000;
    this.backoffMs = this.firstBackoffMs;
    this.useSettings(opts.settings);
  }

  private save(): void {
    this.file.save(this.state);
    this.savedAt = Date.now();
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

  /**
   * What Discord says a thread now is: archived by itself after a quiet week,
   * say, which the bridge must know before it edits a forum post's card.
   */
  noteThread(channel: Channel): void {
    for (const held of Object.values(this.state.threads)) {
      if (held.thread !== channel.id) continue;
      if (channel.thread_metadata !== undefined) held.archived = channel.thread_metadata.archived;
      if (channel.name !== undefined) held.name = channel.name;
    }
  }

  /**
   * The record with a thread that `ref` names, by id or by prefix as the
   * tracker reads one; null for none, or for a prefix of several.
   */
  threaded(ref: string): string | null {
    const found = this.core.resolvePrefix(ref, Object.keys(this.state.threads));
    return found.ok ? found.id : null;
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
    if (this.retry !== null) clearTimeout(this.retry.timer);
    this.retry = null;
    await this.queue.catch(() => undefined);
    this.save();
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
      const channel = channelFor(
        this.core,
        record,
        this.settings,
        this.rulesFor(view.ext),
        view.policy,
        view.ext,
      );
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
      this.save();
      return { thread, created: true };
    });
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
    let refs: string | null = null;
    try {
      refs = await this.refsDigest();
      if (refs === this.lastRefs && !this.forced) return;
      this.forced = false;
      const view = await this.readView();
      this.view = view;
      this.reloadSettings(view.settings);
      await this.findThreads();
      const { failed, waiting } = await this.reconcile(view);
      this.save();
      // What was read is done with either way: a sync that moved nothing
      // reads nothing again. What failed is tried again on the backoff, or
      // sooner when the tracker moves; a rename waiting for Discord's limit,
      // a minute on.
      this.lastRefs = refs;
      this.clear("run");
      if (failed) this.retryAfterFailure();
      else this.backoffMs = this.firstBackoffMs;
      if (waiting) this.retryLater(60_000);
      if (!this.caughtUp) {
        this.caughtUp = true;
        this.host.report(
          `following ${view.records.size} issues and pull requests, ${Object.keys(this.state.threads).length} with a thread`,
        );
      }
    } catch (error) {
      this.lastRefs = refs;
      this.say("run", `could not bring Discord up to date: ${messageOf(error)}`);
      this.retryAfterFailure();
    }
  }

  /** Try again after the backoff, and wait twice as long the next time. */
  private retryAfterFailure(): void {
    this.retryLater(this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, 5 * 60_000);
  }

  /**
   * Say, once each, what is wrong with the channels the settings name: one
   * Discord does not know, one in another guild, one that is neither a forum
   * nor a text channel. Better told when the bridge connects than when the
   * first thread is due.
   */
  async checkChannels(): Promise<void> {
    for (const id of this.namedChannels()) {
      try {
        const channel = await this.threads.channel(id, true);
        if (channel.guild_id !== undefined && channel.guild_id !== this.settings.guild) {
          this.say(
            `channel ${id}`,
            `channel ${id} is in another guild than ${this.settings.guild}`,
          );
        } else if (
          channel.type !== ChannelType.GuildForum &&
          channel.type !== ChannelType.GuildText
        ) {
          this.say(`channel ${id}`, `channel ${id} is neither a forum nor a text channel`);
        } else {
          this.clear(`channel ${id}`);
        }
      } catch (error) {
        this.say(`channel ${id}`, `channel ${id} cannot be used: ${messageOf(error)}`);
      }
    }
  }

  /** Every channel the settings name, once each. */
  private namedChannels(): string[] {
    return [
      ...new Set([
        ...(this.settings.prs === null ? [] : [this.settings.prs.channel]),
        ...this.settings.issues.map((rule) => rule.channel),
      ]),
    ];
  }

  /**
   * Find the bridge's threads in Discord, once, when it knows of none: its
   * state was lost, or this is its first start. Each is known by its name,
   * which begins with the record's id, so none is made twice.
   */
  private async findThreads(): Promise<void> {
    if (this.searched) return;
    if (Object.keys(this.state.threads).length > 0) {
      this.searched = true;
      return;
    }
    const found = await this.threads.find(this.settings.guild, this.namedChannels());
    for (const [id, thread] of found) this.state.threads[id] = thread;
    if (found.size > 0) this.host.report(`found ${found.size} threads the bridge made before`);
    this.searched = true;
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
      const writes = this.threads.writes;
      try {
        await this.deliver(id, before, record, after, events, view);
      } catch (error) {
        // Only a thread the bridge had can be gone; a 404 for a channel it
        // was making one in is a setting to fix, and said so below.
        if (thread !== undefined && isGone(error)) {
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
          // A name Discord refused would be refused again every minute: it is
          // asked for again only once the title changes.
          const held = this.state.threads[id];
          if (held !== undefined && record !== undefined) held.name = threadName(record);
        }
      }
      this.clear(`record ${id}`);
      if (after === undefined) delete seen[id];
      else seen[id] = after;
      // Saved soon after Discord was told something, so a restart does not
      // tell it again — at most once a second, since the whole state is
      // written each time; the run's end saves the rest.
      if (this.threads.writes !== writes && Date.now() - this.savedAt >= SAVE_SPACING_MS) {
        this.save();
      }
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
      const channel = openingFor(
        this.core,
        record,
        weighed,
        this.settings,
        this.rulesFor(view.ext),
        view.policy,
        view.ext,
      );
      if (channel === null) return;
      thread = await this.open(record, channel, view);
      this.state.threads[id] = thread;
      // Saved before anything else is posted: a thread made twice is the one
      // mistake a run tried again could not take back.
      this.save();
      // The card names who is asked for something; only a message notifies them.
      const told = before === undefined ? asked(this.core, record) : events;
      for (const each of this.untold(id, before, ctx, record, after, told)) {
        await this.tell(thread, each);
      }
      // Opened by a rule on a record already settled — `status:closed` — and
      // so archived, as its thread would have been had it had one before.
      if (record.status !== "open") await this.threads.patch(thread, { archived: true });
      return;
    }

    if (record === undefined || after === undefined) {
      for (const each of this.untold(id, before, ctx, null, before as Seen, events)) {
        await this.tell(thread, each);
      }
      if (!thread.archived) await this.threads.patch(thread, { archived: true });
      return;
    }

    const body = card(ctx, record);
    const drawn = hashOf(body);
    const settled = record.status !== "open";
    // Seen for the first time, yet already with a thread: one made by a run
    // that stopped before it told the people the record asks for something.
    const told = events.some((event) => event.type === "opened")
      ? [...events, ...asked(this.core, record)]
      : events;
    const messages = this.untold(id, before, ctx, record, after, told);
    // A forum post's card is inside the thread, and an archived thread's
    // messages cannot be edited: open it first, as posting would anyway.
    if (
      thread.archived &&
      (messages.length > 0 || !settled || (drawn !== thread.card && thread.forum))
    ) {
      await this.threads.patch(thread, { archived: false });
    }
    if (drawn !== thread.card) {
      await this.threads.editCard(thread, body);
      thread.card = drawn;
    }
    for (const each of messages) await this.tell(thread, each);

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
    // An archived thread is renamed or retagged only as it is opened again,
    // in the same request; it is archived again after, if it should be.
    if (Object.keys(change).length > 0 && thread.archived) change.archived = false;
    await this.threads.patch(thread, change);
    if (settled && !thread.archived) await this.threads.patch(thread, { archived: true });
  }

  /**
   * The messages `events` make that the thread has not been told yet.
   *
   * Each is keyed by what it tells: a comment by its id, anything else by the
   * record's state before and the event, so the same change tried again after
   * a failure part of the way through is not posted twice — and the same
   * change made again later, from another state, is.
   */
  private untold(
    id: string,
    before: Seen | undefined,
    ctx: RenderContext,
    record: EntityRecord | null,
    last: Seen,
    events: readonly EntityEvent[],
  ): Telling[] {
    const out: Telling[] = [];
    for (const event of events) {
      const key =
        event.type === "comment"
          ? `comment:${event.id}`
          : `${id}:${createHash("sha1")
              .update(JSON.stringify([before ?? null, event]))
              .digest("hex")
              .slice(0, 20)}`;
      if (this.told.has(key)) continue;
      const message = messageFor(ctx, record, last, event, this.watched);
      if (message !== null) out.push({ key, message });
    }
    return out;
  }

  /** Post one message, named by its key so Discord does not make it twice, and remember it. */
  private async tell(thread: ThreadRef, { key, message }: Telling): Promise<void> {
    await this.threads.post(thread, message, createHash("sha1").update(key).digest("hex"));
    this.told.add(key);
    this.state.told.push(key);
    if (this.state.told.length > TOLD_LIMIT) this.told.delete(this.state.told.shift() as string);
  }

  /**
   * Start a record's thread in `channel`, with its card drawn.
   *
   * Discord takes no nonce for a forum post, so a request whose answer was
   * lost — a 5xx, a dropped connection, a stop — may have made the thread
   * anyway. Each request is noted in the state before it is sent, and one
   * noted and never answered is looked for in Discord before another is made.
   */
  private async open(record: EntityRecord, channel: string, view: View): Promise<ThreadRef> {
    const asked = this.state.opening[record.id];
    const again = asked?.channel === channel;
    if (again) {
      const made = await this.threads.made(this.settings.guild, channel, record.id);
      if (made !== null) {
        delete this.state.opening[record.id];
        return made;
      }
    }
    const at = again ? asked.at : Date.now();
    this.state.opening[record.id] = { channel, at };
    this.save();
    const body = card(this.renderContext(view), record);
    const thread = await this.threads.open(
      channel,
      this.settings.guild,
      threadName(record),
      body,
      (available) => tagIds(tagNames(this.core, record), available ?? []),
      createHash("sha1").update(`card:${record.id}:${at}`).digest("hex"),
    );
    delete this.state.opening[record.id];
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

  /** Run again, forced, in `ms` — or sooner, if a run is already due sooner. */
  private retryLater(ms: number): void {
    if (this.stopped) return;
    const at = Date.now() + ms;
    if (this.retry !== null) {
      if (this.retry.at <= at) return;
      clearTimeout(this.retry.timer);
    }
    const timer = setTimeout(() => {
      this.retry = null;
      this.forced = true;
      this.notify();
    }, ms);
    timer.unref();
    this.retry = { timer, at };
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
  if (error instanceof ChannelRefused) return false;
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
