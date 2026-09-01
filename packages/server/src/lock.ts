/**
 * One operation at a time.
 *
 * The server has a single working tree, and an operation that pulls, writes and
 * commits cannot interleave with another doing the same. Reads take it too: a
 * read's pull moves the tree under any operation that did not.
 *
 * As things stand it guards less than it looks. Every core operation is
 * synchronous — git runs through `spawnSync` — so an operation already runs to
 * completion in one turn of the event loop and could not be interleaved anyway.
 * What the lock does today is order the awaits *around* those turns (a field
 * resolver reading the tree after its parent's transaction has returned) and
 * make {@link Mutex.drain} meaningful at shutdown. What it is really for is the
 * day the git layer stops being synchronous, which is the fix for it blocking
 * the event loop: on that day this is what keeps the guarantee.
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
