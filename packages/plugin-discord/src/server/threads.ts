/**
 * Threads in Discord: making one, posting in it, keeping its card, name, tags
 * and archive state in step with the record it is about.
 *
 * Two kinds of channel hold them. A forum makes a post — a thread whose first
 * message is the card — in one request, and has tags. A text channel holds the
 * card as a message and a thread hangs from it. Either way the thread and its
 * card share an id, which is all the bridge needs to keep.
 */

import type { DiscordRest } from "./discord/rest.ts";
import { DiscordError } from "./discord/rest.ts";
import { type Channel, ChannelType, type Message, type MessageBody } from "./discord/types.ts";
import { idOfThreadName } from "./render.ts";
import type { ThreadRef } from "./state.ts";

/** A week: how long a quiet thread stays in the channel list (Discord's longest). */
const AUTO_ARCHIVE_MINUTES = 10_080;

/** Discord allows a thread two renames in ten minutes; the bridge waits five between its own. */
export const RENAME_SPACING_MS = 5 * 60_000;

/** How long a channel's description (its type, its tags) is trusted before it is asked again. */
const CHANNEL_TTL_MS = 10 * 60_000;

/** The errors after which a thread is gone: unknown channel, unknown message. */
export function isGone(error: unknown): boolean {
  return error instanceof DiscordError && (error.code === 10003 || error.code === 10008);
}

/** The refusal to touch an archived thread's messages, which reopening it answers. */
function isArchived(error: unknown): boolean {
  return error instanceof DiscordError && error.code === 50083;
}

export class Threads {
  private readonly rest: DiscordRest;
  private readonly channels = new Map<string, { channel: Channel; at: number }>();
  /** How many changes were sent to Discord: a run that sent none has nothing new to save. */
  writes = 0;

  constructor(rest: DiscordRest) {
    this.rest = rest;
  }

  /** A channel as Discord describes it, remembered for a while. */
  async channel(id: string, fresh = false): Promise<Channel> {
    const held = this.channels.get(id);
    if (!fresh && held !== undefined && Date.now() - held.at < CHANNEL_TTL_MS) return held.channel;
    const channel = await this.rest.get<Channel>(`/channels/${id}`);
    this.channels.set(id, { channel, at: Date.now() });
    return channel;
  }

  /** Start a thread in `parent` with `card` as its first message. */
  async open(
    parent: string,
    name: string,
    card: MessageBody,
    tags: (available: Channel["available_tags"]) => string[],
  ): Promise<ThreadRef> {
    const channel = await this.channel(parent);
    this.writes++;
    if (channel.type === ChannelType.GuildForum) {
      const applied = tags(channel.available_tags);
      const thread = await this.rest.post<Channel>(`/channels/${parent}/threads`, {
        name,
        auto_archive_duration: AUTO_ARCHIVE_MINUTES,
        ...(applied.length > 0 ? { applied_tags: applied } : {}),
        message: card,
      });
      return ref(thread.id, parent, true, name, applied);
    }
    if (channel.type !== ChannelType.GuildText) {
      throw new Error(`channel ${parent} is neither a forum nor a text channel`);
    }
    const message = await this.rest.post<Message>(`/channels/${parent}/messages`, card);
    const thread = await this.rest.post<Channel>(
      `/channels/${parent}/messages/${message.id}/threads`,
      { name, auto_archive_duration: AUTO_ARCHIVE_MINUTES },
    );
    return ref(thread.id, parent, false, name, []);
  }

  post(thread: ThreadRef, body: MessageBody): Promise<Message> {
    // Posting brings an archived thread back, as Discord does on its own.
    thread.archived = false;
    this.writes++;
    return this.rest.post<Message>(`/channels/${thread.thread}/messages`, body);
  }

  /**
   * Redraw the card: in the thread for a forum post, in the parent channel
   * otherwise. A forum post Discord archived on its own after a quiet week
   * refuses the edit; it is reopened and the edit made again.
   */
  async editCard(thread: ThreadRef, body: MessageBody): Promise<void> {
    const where = thread.forum ? thread.thread : thread.parent;
    const route = `/channels/${where}/messages/${thread.thread}`;
    this.writes++;
    try {
      await this.rest.patch(route, body);
    } catch (error) {
      if (!thread.forum || !isArchived(error)) throw error;
      await this.patch(thread, { archived: false });
      await this.rest.patch(route, body);
    }
  }

  /** Change what is given about the thread itself, and remember it. */
  async patch(
    thread: ThreadRef,
    change: { name?: string; applied_tags?: string[]; archived?: boolean },
  ): Promise<void> {
    if (Object.keys(change).length === 0) return;
    this.writes++;
    await this.rest.patch(`/channels/${thread.thread}`, change);
    if (change.name !== undefined) {
      thread.name = change.name;
      thread.renamedAt = Date.now();
    }
    if (change.applied_tags !== undefined) thread.tags = change.applied_tags;
    if (change.archived !== undefined) thread.archived = change.archived;
  }

  /**
   * Every thread in `parents` the bridge named, by the record it is about —
   * active ones from the guild's list, archived ones page by page — for when
   * the bridge's state was lost and its threads must be found again.
   */
  async find(guild: string, named: readonly string[]): Promise<Map<string, ThreadRef>> {
    const found = new Map<string, ThreadRef>();
    const forums = new Set<string>();
    // A channel that cannot be read holds no thread the bridge can use; what
    // is wrong with it is said when the bridge connects (`checkChannels`).
    const parents: string[] = [];
    for (const parent of named) {
      try {
        if ((await this.channel(parent)).type === ChannelType.GuildForum) forums.add(parent);
        parents.push(parent);
      } catch (error) {
        if (!(error instanceof DiscordError) || error.status >= 500 || error.status === 429) {
          throw error;
        }
      }
    }
    const take = (thread: Channel): void => {
      const id = idOfThreadName(thread.name);
      if (id === null || thread.parent_id == null || !parents.includes(thread.parent_id)) return;
      if (found.has(id)) return;
      const held = ref(
        thread.id,
        thread.parent_id,
        forums.has(thread.parent_id),
        thread.name ?? "",
        thread.applied_tags ?? [],
      );
      held.archived = thread.thread_metadata?.archived === true;
      found.set(id, held);
    };
    const active = await this.rest.get<{ threads: Channel[] }>(`/guilds/${guild}/threads/active`);
    for (const thread of active.threads) take(thread);
    for (const parent of parents) {
      let before: string | null = null;
      for (;;) {
        const query = `?limit=100${before === null ? "" : `&before=${encodeURIComponent(before)}`}`;
        const page: { threads: Channel[]; has_more?: boolean } = await this.rest.get(
          `/channels/${parent}/threads/archived/public${query}`,
        );
        for (const thread of page.threads) take(thread);
        const stamp = page.threads.at(-1)?.thread_metadata?.archive_timestamp;
        if (page.has_more !== true || stamp === undefined) break;
        before = stamp;
      }
    }
    return found;
  }
}

function ref(
  thread: string,
  parent: string,
  forum: boolean,
  name: string,
  tags: string[],
): ThreadRef {
  return {
    thread,
    parent,
    forum,
    name,
    // Naming a thread as it is made is no rename: the first one may come at once.
    renamedAt: 0,
    archived: false,
    tags,
    card: null,
  };
}
