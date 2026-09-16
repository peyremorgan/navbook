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
 */
export class Mutex {
  /** Resolves when everything queued so far has finished, one way or another. */
  private tail: Promise<unknown> = Promise.resolve();

  /** Queue `body`, running it once every earlier caller has finished. */
  run<T>(body: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(body);
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
