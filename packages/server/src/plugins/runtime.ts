/**
 * The server's plugin runtime: resolvers to merge, services to run, and
 * listeners to tell.
 *
 * One per server, built at startup. Unlike the CLI's, this one loads
 * everything up front and keeps it: a server is started once and answers for
 * days, so there is no invocation to make cheap, and a schema assembled lazily
 * would be a schema that changed shape after the first request.
 */

import type { EntityRecord } from "@navbook/core";
import type { PluginResolvers } from "../schema.ts";
import type { EntityInputBridge, MutationEvent, PluginService } from "./host.ts";

/** One plugin's contribution to `Entity.ext`, under the name it appears at. */
interface ExtReader {
  short: string;
  read: (entity: EntityRecord) => unknown;
}

export class PluginRuntime {
  readonly resolvers: PluginResolvers[] = [];
  readonly services: PluginService[] = [];
  readonly bridges: EntityInputBridge[] = [];
  readonly extReaders: ExtReader[] = [];
  #listeners: ((event: MutationEvent) => void)[] = [];
  /** The services running now, in the order they started. */
  #started: PluginService[] = [];
  #report: (line: string) => void;

  constructor(report: (line: string) => void) {
    this.#report = report;
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
   * The write has already committed and pushed by the time this runs, so there
   * is nothing left to roll back and nothing a listener could usefully refuse.
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
   */
  async stop(): Promise<void> {
    const running = this.#started.reverse();
    this.#started = [];
    for (const service of running) {
      try {
        await service.stop();
      } catch (error) {
        this.#report(
          `plugin service '${service.name}' did not stop cleanly: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}
