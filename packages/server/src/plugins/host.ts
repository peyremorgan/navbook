/**
 * What a plugin's `./server` entry is handed — spec 06 §6.2, §6.3.
 *
 * The server is the one front end where a plugin may keep running after the
 * request that started it: a chat bridge listens for messages nobody asked it
 * about, and commits on their author's behalf. That is the non-committer
 * gateway of §6.2, and it belongs inside this process rather than beside it
 * because the server already owns the clone, serialises operations against it
 * and synchronises it with the origin. A second program doing the same thing
 * to the same repository would be racing it.
 *
 * So this host carries three things the CLI's does not: a way to add to the
 * schema, a way to register something long-running, and the event every
 * committed mutation emits.
 */

import type * as NavbookCore from "@navbook/core";
import type { Identity, PluginManifest } from "@navbook/core";
import type { Config } from "../config.ts";
import type { GraphQLCtx } from "../context.ts";
import type { AuthorCache } from "../people.ts";
import type { PluginResolvers } from "../schema.ts";
import type { RepoSync } from "../sync.ts";

/** What every server entry exports. */
export interface ServerPluginEntry {
  activate(host: ServerPluginHost): void | Promise<void>;
}

/**
 * What happened, told to every service after a mutation has committed.
 *
 * Emitted from the one place every mutation passes through, after the write
 * transaction has released — so a listener sees a tree that has settled, and
 * cannot deadlock by trying to read it. It carries what was done rather than
 * the entity itself: a listener that wants the entity reads it, and one that
 * only wants to announce the change does not pay for a parse.
 */
export interface MutationEvent {
  /** The commit subject, e.g. `docs(issue): open #ab12cd34`. */
  subject: string;
  /** The full message, trailers included. */
  message: string;
  /** False when the operation turned out to be a no-op. */
  committed: boolean;
  /** Whether the commit reached the remote; false is a `SYNC_CONFLICT`. */
  pushed: boolean;
  /** Who the token said was acting — the person, not the machine account. */
  viewer: Identity;
  /** When it happened, ISO 8601 with second precision. */
  at: string;
}

/**
 * Something that runs for as long as the server does.
 *
 * `stop` is awaited during shutdown, before the clone is released, so a
 * service that holds a socket or a poll loop can close it. A service that
 * throws while starting stops the server: it was configured, so it was wanted,
 * and a bridge that silently did not connect is worse than one that refused
 * to come up.
 */
export interface PluginService {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ServerPluginHost {
  /** The running core — the server's copy, never one the plugin resolved. */
  core: typeof NavbookCore;
  manifest: PluginManifest;
  /** What `navbook.json` declares under this plugin's name (spec 02 §2.12). */
  settings: Record<string, unknown>;
  /** The server's own configuration, for a plugin that needs the repo path. */
  config: Config;
  /**
   * This plugin's `NAV_SERVER_<SHORT>_*` values, already validated.
   *
   * Keyed by the full variable name the manifest declared. Required keys are
   * checked at startup with the server's own, so a bridge with no token
   * refuses to start rather than failing on its first message.
   */
  pluginConfig: Record<string, string>;
  /** The clone's synchronisation, for a service that must write. */
  sync: RepoSync;
  /** The people this history knows, for a service resolving a name. */
  authors: AuthorCache;
  /** Say something at startup, into the same log the server uses. */
  report(line: string): void;
  /** Resolvers for the types this plugin's SDL added or extended. */
  resolvers(map: PluginResolvers): void;
  /** Register something that runs for as long as the server does. */
  service(service: PluginService): void;
  /** Subscribe to every committed mutation, this plugin's included. */
  onMutation(listener: (event: MutationEvent) => void): void;
}
