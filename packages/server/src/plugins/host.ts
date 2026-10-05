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
import type {
  EntityKind,
  EntityRecord,
  Identity,
  PluginManifest,
  RunPlanResult,
  WsCtx,
} from "@navbook/core";
import type { ExecutionResult, GraphQLSchema } from "graphql";
import type { Config } from "../config.ts";
import type { GraphQLCtx } from "../context.ts";
import type { AuthorCache } from "../people.ts";
import type { PluginResolvers } from "../schema.ts";
import type { RepoSync, WriteResult } from "../sync.ts";
import type { WriteSite } from "../write-site.ts";

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
  /**
   * Whether the commit reached the remote: false when the server has no
   * remote, or nothing was committed. A write whose push fails throws before
   * any event, so no listener hears of a change its author was told failed.
   */
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

/** How a plugin's own input fields reach the format and the query. */
export interface EntityInputBridge {
  /** Frontmatter for a newly composed entity, read off the mutation's input. */
  openFields?(input: Record<string, unknown>): Record<string, string | readonly string[]>;
  /** Keys to patch on an existing entity, including nulls that clear one. */
  patchFields?(input: Record<string, unknown>): Record<string, unknown>;
  /** Registered query terms a filter asks for, by key. */
  filterTerms?(filter: Record<string, unknown>): Record<string, string[]>;
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
  /**
   * Bridge the fields a plugin added to an input onto the format.
   *
   * A plugin's SDL can add `features` to `OpenIssueInput` and to the two
   * filters, `IssueFilter` and `PrFilter`, but the resolver that composes an
   * issue is the host's and knows nothing about them. These two hooks are how the values reach the
   * file and the query: the host calls them where it builds each, so a
   * plugin's field behaves exactly as a built-in one does rather than needing
   * its own mutation.
   */
  entityInput(bridge: EntityInputBridge): void;
  /**
   * What this plugin has to say about an entity, for `Entity.ext`.
   *
   * The counterpart of `entityInput`, for reads rather than writes, and it
   * exists for something a plugin's *web* half cannot do. `extend type Issue`
   * adds a field, but a GraphQL fragment cannot be extended — so the host's
   * own list-row fragment, written in this repository, can never name it, and
   * a plugin's badge on a row the host fetched would have nothing to draw.
   *
   * Whatever this returns appears under the plugin's short name on every issue
   * and pull request the API serves. It is called once per entity in a
   * listing, so it reads the record it is handed and nothing else: a lookup
   * here would be one lookup per row.
   */
  entityExt(read: (entity: EntityRecord) => unknown): void;
  /**
   * The pieces a resolver needs to behave like a built-in one.
   *
   * Named rather than left to a plugin to reimplement, because each of them is
   * a decision this server has already made: how a `WorkspaceError` becomes a
   * GraphQL error with the right extension code, what an empty required field
   * is called, and that a composed file is validated before it is written. A
   * plugin reproducing them would reproduce them slightly differently, and the
   * difference would show up as one mutation reporting a fault unlike every
   * other.
   */
  api: {
    /** Run an operation, translating a core failure into a GraphQL error. */
    run<T>(operation: () => T | Promise<T>): Promise<T>;
    /** The error a malformed request gets, with its extension code. */
    invalidInput(message: string): Error;
    /**
     * Any other refusal, under the extension code given — `apiError` itself.
     *
     * Here rather than only re-exported below: a plugin installed from the
     * store has no copy of this server to import it from, so a value it needs
     * at runtime has to be handed to it.
     */
    apiError(message: string, code: string, extensions?: Record<string, unknown>): Error;
    /** Refuse an empty required string, naming the field. */
    requireText(value: string, field: string): void;
    /** Validate a composed file before it is written, as the built-ins do. */
    checkComposed(
      content: string,
      validate: (parsed: import("@navbook/core").ParsedFile) => { message: string }[],
      noun: string,
    ): void;
    /**
     * The entity a write is to be made to, in the branch this server serves.
     *
     * Refuses a pull request this checkout does not hold with `PRECONDITION`
     * and the `sourceRef` that carries it: a pull request's files live on the
     * branch it proposes to merge, so anything a plugin keeps beside `pr.md`
     * is written there or nowhere. `writeEntity` writes there instead.
     */
    writeTarget(ctx: GraphQLCtx, kind: EntityKind, ref: string): EntityRecord;
    /** Report a commit to the client, and emit the mutation event. */
    commitInfo(
      ctx: GraphQLCtx,
      result: RunPlanResult,
      pushed: boolean,
    ): { committed: boolean; subject: string; pushed: boolean };
    /**
     * Write beside an entity, where it lives, the way `addComment` does.
     *
     * An issue is written in the clone. A pull request is written on its own
     * branch — in a temporary worktree when the clone does not hold it — and
     * that branch is pushed. `body` runs synchronously under the lock, with a
     * workspace rooted at that site and the entity as read there, and must
     * commit what it writes: the push follows when `result.run` committed.
     *
     * It tells nobody. A built-in mutation reports through `commitInfo`, which
     * is what emits the mutation event services listen for; a plugin's must
     * call it too, with the `run` and `pushed` this resolves to, or its write
     * is the one change a chat bridge never hears of.
     */
    writeEntity<T extends { run: RunPlanResult }>(
      ctx: GraphQLCtx,
      kind: EntityKind,
      ref: string,
      body: (at: WsCtx, entity: EntityRecord, site: WriteSite) => T,
    ): Promise<WriteResult<T>>;
    /**
     * Run an operation against the schema this server serves, as `ctx`'s viewer.
     *
     * The same resolvers, transactions, error codes and mutation event as a
     * request from a client, so a plugin acting for somebody — an assistant, a
     * bridge — needs no copy of any of them.
     *
     * Called from a resolver, with the context that resolver was handed: a
     * context is built for each request, so there is none outside one, and a
     * service has nothing to pass. Never from inside `sync.read`, `sync.write`,
     * `sync.locked` or a `writeEntity` body — the operation's own resolvers
     * take the repository lock, which is not re-entrant, so it would wait for
     * itself and every request after it would wait too. That call is refused.
     */
    execute(
      ctx: GraphQLCtx,
      source: string,
      variables?: Record<string, unknown>,
    ): Promise<ExecutionResult>;
    /**
     * The schema this server serves, once every plugin has activated.
     *
     * What a service can use: it cannot run an operation, having no request's
     * context, but it can check in its `start` that the documents its
     * resolvers will run are ones this schema answers.
     */
    schema(): GraphQLSchema;
  };
}

// A plugin's resolvers are handed the server's own context, and its patchers
// report through the server's own errors. Re-exported here so `./plugin` is
// the whole surface a plugin types against, rather than one of three imports.
export type { GraphQLCtx } from "../context.ts";
export { apiError, invalidInput } from "../errors.ts";
export type { WriteResult } from "../sync.ts";
export type { WriteSite } from "../write-site.ts";
