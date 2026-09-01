/**
 * One operation at a time.
 *
 * The server has a single working tree, and an operation that pulls, writes and
 * commits cannot interleave with another doing the same. Reads take the lock
 * too: a read's pull moves the tree under any operation that did not.
 *
 * Every core operation is synchronous (git is run through `spawnSync`), so the
 * lock exists to order the awaits *around* them — the fetch, the push, and the
 * request boundary — rather than to guard against a preempted operation.
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
