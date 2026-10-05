import { AsyncLocalStorage } from "node:async_hooks";

/**
 * One operation at a time.
 *
 * The server has a single working tree, and an operation that pulls, writes and
 * commits cannot interleave with another doing the same. Reads take it too: a
 * read's pull moves the tree under any operation that did not.
 *
 * The git calls an operation makes are awaited, so an operation spans many
 * turns of the event loop and the loop answers other requests in between —
 * requests that need the tree wait here, and requests that do not (a health
 * probe, the GraphiQL page, a refused token) are answered at once. This is
 * what makes the queue the guarantee rather than an ornament: without it a
 * read could run between another operation's pull and its commit, on a tree
 * mid-move. It is also what makes {@link Mutex.drain} mean something at
 * shutdown, where a mutation between its commit and its push is the one
 * moment the clone's state depends on finishing.
 *
 * It is not re-entrant, and must not be: a body that queued a second operation
 * and awaited it would wait for itself, and every request behind it — and the
 * drain at shutdown — would wait for ever. Nothing in this server does that,
 * but a plugin running an operation of its own could, so the queue knows who
 * holds it ({@link Mutex.held}) and the door a plugin would come in by asks.
 */
export class Mutex {
  /** Resolves when everything queued so far has finished, one way or another. */
  private tail: Promise<unknown> = Promise.resolve();
  /** Set in a body's async context, so whatever the body awaits can tell it holds the lock. */
  private readonly holder = new AsyncLocalStorage<true>();

  /**
   * True in code running under this lock: in a body `run` was given, and in
   * anything that body called, awaited or started.
   */
  get held(): boolean {
    return this.holder.getStore() === true;
  }

  /** Queue `body`, running it once every earlier caller has finished. */
  run<T>(body: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(() => this.holder.run(true, body));
    // A rejection is the caller's to handle, and must not break the chain for
    // whoever is queued behind them.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Resolves when the queue is empty, so shutdown never cuts an operation in half. */
  async drain(): Promise<void> {
    await this.tail;
  }
}
