/**
 * The server's plugin runtime: resolvers to merge, services to run, and
 * listeners to tell.
 *
 * One per server, built at startup. Unlike the CLI's, this one loads
 * everything up front and keeps it: a server is started once and answers for
 * days, so there is no invocation to make cheap, and a schema assembled lazily
 * would be a schema that changed shape after the first request.
 */

import type { GraphQLCtx } from "../context.ts";
import type { PluginResolvers } from "../schema.ts";
import type { MutationEvent, PluginService } from "./host.ts";

export class PluginRuntime {
  readonly resolvers: PluginResolvers[] = [];
  readonly services: PluginService[] = [];
  #listeners: ((event: MutationEvent) => void)[] = [];
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

  /** Start every service, in registration order. */
  async start(): Promise<void> {
    for (const service of this.services) {
      await service.start();
      this.#report(`started plugin service '${service.name}'`);
    }
  }

  /**
   * Stop every service, in reverse order, and report rather than throw.
   *
   * Shutdown has to finish. A service whose `stop` rejects must not leave the
   * ones after it running, nor stop the clone being released, so each is
   * awaited on its own and a failure is news rather than an exception.
   */
  async stop(): Promise<void> {
    for (const service of [...this.services].reverse()) {
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
