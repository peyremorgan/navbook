/**
 * The server's plugin runtime: resolvers to merge, services to run, and
 * listeners to tell.
 *
 * One per server, built at startup. Unlike the CLI's, this one loads
 * everything up front and keeps it: a server is started once and answers for
 * days, so there is no invocation to make cheap, and a schema assembled lazily
 * would be a schema that changed shape after the first request.
 */

import type { EntityRecord, Identity } from "@navbook/core";
import {
  type DocumentNode,
  type ExecutionResult,
  execute,
  GraphQLError,
  type GraphQLSchema,
  parse,
  validate,
} from "graphql";
import type { GraphQLCtx } from "../context.ts";
import type { PluginField } from "../patch.ts";
import type { PluginResolvers } from "../schema.ts";
import type { EntityInputBridge, MutationEvent, PluginService, SyncEvent } from "./host.ts";

/** One plugin's contribution to `Entity.ext`, under the name it appears at. */
interface ExtReader {
  short: string;
  read: (entity: EntityRecord) => unknown;
}

/** How many parsed operations {@link PluginRuntime.execute} remembers. */
const DOCUMENT_CACHE_LIMIT = 256;

/**
 * How long shutdown waits for one service to stop before going on without it.
 *
 * Well inside the time a container is given to stop (`compose.yaml` gives
 * 75 s), which also has to cover a push in flight and the clone's release.
 */
export const SERVICE_STOP_TIMEOUT_MS = 10_000;

export interface RuntimeOptions {
  /** {@link SERVICE_STOP_TIMEOUT_MS}, unless a test needs to wait less. */
  stopTimeoutMs?: number;
}

/**
 * Builds the context a request would have, for whoever `contextFor` is asked
 * about — or, asked about nobody, for the server's own identity.
 */
export type ContextFactory = (viewer?: Identity) => GraphQLCtx;

export class PluginRuntime {
  readonly resolvers: PluginResolvers[] = [];
  readonly services: PluginService[] = [];
  readonly bridges: EntityInputBridge[] = [];
  readonly extReaders: ExtReader[] = [];
  #listeners: ((event: MutationEvent) => void)[] = [];
  #syncListeners: ((event: SyncEvent) => void | Promise<void>)[] = [];
  /** The services running now, in the order they started. */
  #started: PluginService[] = [];
  #report: (line: string) => void;
  readonly #stopTimeoutMs: number;
  /** The schema the server serves, once it is built from every plugin's SDL. */
  #schema: GraphQLSchema | null = null;
  /** How a context is made, once everything a request's needs exists. */
  #contexts: ContextFactory | null = null;
  /** Each operation a plugin runs, parsed and validated once: plugins run the same few. */
  readonly #documents = new Map<string, DocumentNode | readonly GraphQLError[]>();

  constructor(report: (line: string) => void, opts: RuntimeOptions = {}) {
    this.#report = report;
    this.#stopTimeoutMs = opts.stopTimeoutMs ?? SERVICE_STOP_TIMEOUT_MS;
  }

  /** Called once the schema is built, which is after every plugin activated. */
  setSchema(schema: GraphQLSchema): void {
    this.#schema = schema;
    this.#documents.clear();
  }

  /** The schema the server serves; not available while plugins are activating. */
  schema(): GraphQLSchema {
    if (this.#schema === null) {
      throw new Error(
        "the schema is built once every plugin has activated; use it from a resolver or a service",
      );
    }
    return this.#schema;
  }

  /** Called once with the schema, when the server can build a request's context. */
  setContextFactory(factory: ContextFactory): void {
    this.#contexts = factory;
  }

  /**
   * A context acting as `viewer`, for code that runs outside any request.
   *
   * Built afresh per call, as a request's is: a context remembers the tree it
   * read, so one kept across operations would answer from a tree long gone.
   * Not available while plugins are activating — what a context carries
   * includes every plugin's format, which is only known once all of them are.
   */
  contextFor(viewer?: Identity): GraphQLCtx {
    if (this.#contexts === null) {
      throw new Error(
        "a context is built once every plugin has activated; ask for one from a service or a resolver",
      );
    }
    return this.#contexts(viewer);
  }

  /**
   * Run an operation against the served schema, as the viewer `ctx` names.
   *
   * The same resolvers, transactions, error codes and mutation event as a
   * request from a client, because it *is* one, minus the HTTP. A document
   * that does not parse or validate answers with its errors, as Yoga would.
   *
   * Refused from under the clone's lock. The resolvers it runs take that lock
   * themselves, and the lock is a queue rather than a re-entrant one: called
   * from inside `sync.read`, the operation would wait for the read that is
   * waiting for it, and every request after them would wait too. Refusing is
   * the difference between a plugin's bug and a server that stops answering.
   */
  async execute(
    ctx: GraphQLCtx,
    source: string,
    variables?: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    if (ctx.sync.underLock) {
      throw new Error(
        "host.api.execute was called under the repository lock, where it would wait for itself; " +
          "call it from a resolver, never from inside sync.read, sync.write, sync.locked or a writeEntity body",
      );
    }
    const schema = this.schema();
    let document = this.#documents.get(source);
    if (document === undefined) {
      try {
        const parsed = parse(source);
        const errors = validate(schema, parsed);
        document = errors.length === 0 ? parsed : errors;
      } catch (error) {
        if (!(error instanceof GraphQLError)) throw error;
        document = [error];
      }
      // A plugin runs a fixed handful of documents; one that builds them on the
      // fly would otherwise grow this without end.
      if (this.#documents.size >= DOCUMENT_CACHE_LIMIT) this.#documents.clear();
      this.#documents.set(source, document);
    }
    if (Array.isArray(document)) return { errors: document as readonly GraphQLError[] };
    return await execute({
      schema,
      document: document as DocumentNode,
      contextValue: ctx,
      ...(variables === undefined ? {} : { variableValues: variables }),
    });
  }

  addResolvers(map: PluginResolvers): void {
    this.resolvers.push(map);
  }

  addService(service: PluginService): void {
    this.services.push(service);
  }

  addBridge(bridge: EntityInputBridge): void {
    this.bridges.push(bridge);
  }

  addExtReader(short: string, read: (entity: EntityRecord) => unknown): void {
    this.extReaders.push({ short, read });
  }

  /**
   * `Entity.ext` for one entity: every plugin's slice, under its short name.
   *
   * An empty object when nothing registered, which is what a server with no
   * plugins serves — the field is non-null because a client should be able to
   * write `entity.ext.kb?.features` without first checking that `ext` is there.
   *
   * A reader that throws costs its own key rather than the request. This runs
   * once per row of every listing, and a plugin's bug should not be the reason
   * somebody cannot see their issues.
   */
  entityExt(entity: EntityRecord): Record<string, unknown> {
    const ext: Record<string, unknown> = {};
    for (const { short, read } of this.extReaders) {
      try {
        ext[short] = read(entity);
      } catch (error) {
        this.#report(
          `plugin '${short}' could not read ${entity.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return ext;
  }

  /** Frontmatter every plugin wants on a newly composed entity. */
  openFields(input: Record<string, unknown>): Record<string, string | readonly string[]> {
    return Object.assign({}, ...this.bridges.map((b) => b.openFields?.(input) ?? {}));
  }

  /** Keys every plugin wants patched on an existing entity. */
  patchFields(input: Record<string, unknown>): Record<string, unknown> {
    return Object.assign({}, ...this.bridges.map((b) => b.patchFields?.(input) ?? {}));
  }

  /**
   * The fields of a patch that plugins read, each with the keys it writes.
   *
   * Asked field by field of the same `patchFields` that writes them, so the
   * stale check guards exactly what the write changes and names it as the
   * input does — `features`, not the `feature` key it lands in.
   */
  patchedFields(input: Record<string, unknown>): PluginField[] {
    const fields: PluginField[] = [];
    for (const [field, value] of Object.entries(input)) {
      if (value === undefined) continue;
      const keys = Object.keys(this.patchFields({ [field]: value }));
      if (keys.length > 0) fields.push({ field, keys });
    }
    return fields;
  }

  /** Registered query terms every plugin reads out of a filter. */
  filterTerms(filter: Record<string, unknown>): Record<string, string[]> {
    return Object.assign({}, ...this.bridges.map((b) => b.filterTerms?.(filter) ?? {}));
  }

  onMutation(listener: (event: MutationEvent) => void): void {
    this.#listeners.push(listener);
  }

  /**
   * Tell every listener, and let none of them break the mutation.
   *
   * The write has already committed, and pushed where there is a remote, by
   * the time this runs, so there is nothing left to roll back and nothing a
   * listener could usefully refuse.
   * A listener that throws has a bug in it, and reporting that is strictly
   * better than turning somebody's successful `openIssue` into an error about
   * a chat bridge they may not even know is installed.
   */
  emit(event: MutationEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (error) {
        this.#report(
          `plugin listener failed on '${event.subject}': ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  onSync(listener: (event: SyncEvent) => void | Promise<void>): void {
    this.#syncListeners.push(listener);
  }

  /**
   * Tell every sync listener, each on a turn of its own.
   *
   * The clone has already let go when this is called (`RepoSync`'s
   * `onChange`), and a listener's work — reading what moved, telling a chat
   * service — must not hold up the pull or write that called it. So each runs
   * after this returns, and one that throws or rejects is reported, as a
   * mutation listener is.
   */
  emitSync(event: SyncEvent): void {
    for (const listener of this.#syncListeners) {
      void Promise.resolve()
        .then(() => listener(event))
        .catch((error: unknown) => {
          this.#report(
            `plugin sync listener failed after a ${event.cause}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
    }
  }

  /**
   * Start every service, in registration order.
   *
   * One that cannot start stops the ones before it, then rethrows: the server
   * will not open its port, and a service left running behind it would hold
   * its sockets for a process that is about to exit on a startup fault.
   */
  async start(): Promise<void> {
    for (const service of this.services) {
      try {
        await service.start();
      } catch (error) {
        await this.stop();
        throw error;
      }
      this.#started.push(service);
      this.#report(`started plugin service '${service.name}'`);
    }
  }

  /**
   * Stop every running service, in reverse order, and report rather than throw.
   *
   * Shutdown has to finish. A service whose `stop` rejects must not leave the
   * ones after it running, nor stop the clone being released, so each is
   * awaited on its own and a failure is news rather than an exception. Only
   * what started is stopped, and only once.
   *
   * Nor may one that never returns hold the rest up: a socket that will not
   * close is a service's bug, and the clone it would keep from being released
   * is everybody's. After {@link SERVICE_STOP_TIMEOUT_MS} it is left to the
   * process exit, and the log says so.
   */
  async stop(): Promise<void> {
    const running = this.#started.reverse();
    this.#started = [];
    for (const service of running) {
      let timer: NodeJS.Timeout | undefined;
      const abandoned = new Promise<"abandoned">((resolve) => {
        timer = setTimeout(() => resolve("abandoned"), this.#stopTimeoutMs);
      });
      try {
        const stopped = Promise.resolve()
          .then(() => service.stop())
          .then(() => "stopped" as const);
        if ((await Promise.race([stopped, abandoned])) === "abandoned") {
          this.#report(
            `plugin service '${service.name}' did not stop within ${this.#stopTimeoutMs} ms; going on without it`,
          );
          // Whatever it does later is still news, not an unhandled rejection.
          stopped.catch(() => undefined);
        }
      } catch (error) {
        this.#report(
          `plugin service '${service.name}' did not stop cleanly: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        clearTimeout(timer);
      }
    }
  }
}
