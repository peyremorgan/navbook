/**
 * Who this repository knows of, and the half of the answer worth keeping.
 *
 * A history walk is the one part that does not belong to a request: the tree
 * is read per request anyway, and the viewer arrives with the token, but
 * walking every commit to learn a list that only changes when somebody commits
 * would make every menu cost the repository's whole history.
 *
 * So the walk is remembered against the commit it read. HEAD is what moves —
 * `RepoSync` fetches, merges and commits, and nothing else does — which makes
 * the sha both the key and the whole of the invalidation: a cache that is
 * wrong is a cache whose sha is stale, and there is no such thing here.
 *
 * Process-scoped like `RepoSync`, and for its reason: one clone per process
 * (spec 06 §6.3). Not a git-layer concern, because core's git functions hold
 * no state and this is state.
 *
 * Derived, disposable and uncommitted — the only kind of index the format
 * permits anything to keep (spec 06 §6.6).
 */

import { commitAuthors, type Identity, type Person, sameEmail } from "@navbook/core";

export interface AuthorCacheOptions {
  repoRoot: string;
  /**
   * The clone's own committer, left out of the answer.
   *
   * It commits on everybody's behalf (spec 06 §6.2), so its name on a commit
   * says who ran the server rather than who did the work. It is only excluded
   * *here*: where the tree names the machine account as somebody's author or
   * assignee, that is a person saying so and it stands.
   */
  exclude: Identity;
  /** The walk itself, injectable so a test can count how often it happens. */
  load?: (cwd: string, rev: string) => Person[];
}

export class AuthorCache {
  private sha: string | null = null;
  private people: Person[] = [];
  private readonly opts: AuthorCacheOptions;
  private readonly load: (cwd: string, rev: string) => Person[];

  constructor(opts: AuthorCacheOptions) {
    this.opts = opts;
    this.load = opts.load ?? commitAuthors;
  }

  /**
   * The authors of the history at `head`, walked only where that is new.
   *
   * Give it the sha the caller's own transaction resolved, under the same
   * lock: the answer then describes the tree that request is reading rather
   * than whichever one the clone has arrived at since. Takes no lock itself,
   * because the lock is a queue rather than a reentrant one.
   */
  at(head: string | null): readonly Person[] {
    // No HEAD at all: a branch with nothing on it yet. Not an error, and not
    // something to remember either — the next commit is the first.
    if (head === null) return [];
    if (head !== this.sha) {
      this.people = this.load(this.opts.repoRoot, head).filter(
        (person) => !sameEmail(person.email, this.opts.exclude.email),
      );
      this.sha = head;
    }
    return this.people;
  }
}
