/**
 * What a page shows between clicking Save and the server answering.
 *
 * Every write is a fetch, a commit and a push, serialised behind the server's
 * mutex, so the answer is routinely seconds away on a deployed tracker. The
 * field editors close on save, and a page that rendered only what the cache
 * held would spend those seconds showing the *old* value — which reads as the
 * edit having been thrown away, and was reported as exactly that (#fa19dlvj).
 *
 * So the edit is kept here from the moment it is sent, and three things are
 * read out of it:
 *
 * - `overlay` puts the pending value over the cached one, so the page shows
 *   what was saved at once and keeps showing it until the server has either
 *   recorded it or refused it.
 * - `field(name).slow` says a save has been out for a while. It is held back
 *   for {@link SLOW_SAVE_MS}, because on a responsive backend a spinner that
 *   flashes for a quarter of a second is noise, and only becomes worth showing
 *   once the wait is long enough to make somebody wonder.
 * - `field(name).failure` keeps a refused edit beside the value it tried to
 *   set, with the server's own sentence and two answers: send it again, or
 *   drop it. What was typed is the only copy of itself, and losing it to a
 *   toast that disappears in eight seconds is the thing this exists to stop.
 *
 * One kind of refusal is not kept here. A stale refusal — somebody changed the
 * field first — is `useStaleEdit`'s, which reads the page again so what the
 * file says now can be shown beside the edit; `attempt`'s runner reports it as
 * handled rather than throwing, and the overlay is lifted so theirs shows.
 *
 * Nothing here writes to Apollo's cache. When a write lands, the payload has
 * already been normalised into it, so lifting the overlay reveals the same
 * value it was covering.
 */

import { computed, getCurrentScope, onScopeDispose, ref } from "vue";
import { describeApiError, errorHeading } from "~/utils/errors";

/** How long a save is out before the page admits it is still waiting. */
export const SLOW_SAVE_MS = 1750;

export interface SaveFailure {
  /** The short heading for the code, as the toast would have used it. */
  heading: string;
  /** The server's own sentence, with its details. */
  message: string;
}

/** One field's save, as its editor shows it. */
export interface FieldSave {
  /** A write naming this field is in flight. */
  saving: boolean;
  /** It has been in flight for longer than {@link SLOW_SAVE_MS}. */
  slow: boolean;
  /** The last write was refused, and its edit is still shown. */
  failure: SaveFailure | null;
  /** Send the kept edit again. */
  retry(): void;
  /** Drop the kept edit, so the field shows what the file says. */
  discard(): void;
}

interface Entry<E> {
  /** The edit, as it was sent; every field it names is overlaid. */
  change: Partial<E>;
  /** Which attempt this is, so a slow answer cannot settle a newer edit. */
  attempt: number;
  saving: boolean;
  slow: boolean;
  failure: SaveFailure | null;
}

export interface PendingEditsOptions<E> {
  /** Save a kept edit again, through the same path the page saves by. */
  resend: (change: Partial<E>) => Promise<void>;
  /** For tests; the default is {@link SLOW_SAVE_MS}. */
  slowAfterMs?: number;
}

function fieldsOf<E>(change: Partial<E>): (keyof E)[] {
  return (Object.keys(change) as (keyof E)[]).filter((key) => change[key] !== undefined);
}

export function usePendingEdits<E extends object>(opts: PendingEditsOptions<E>) {
  const slowAfter = opts.slowAfterMs ?? SLOW_SAVE_MS;
  const entries = ref(new Map<keyof E, Entry<E>>());
  const timers = new Map<keyof E, ReturnType<typeof setTimeout>>();
  let attempts = 0;

  /** Every pending timer, dropped with the page: a spinner for nobody. */
  if (getCurrentScope()) {
    onScopeDispose(() => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    });
  }

  // `ref` on a Map is deep by default, but a Map is replaced wholesale here
  // on every change so that a computed reading it is sure to be told.
  function set(field: keyof E, entry: Entry<E> | null): void {
    const next = new Map(entries.value as Map<keyof E, Entry<E>>);
    if (entry === null) next.delete(field);
    else next.set(field, entry);
    entries.value = next;
  }

  function get(field: keyof E): Entry<E> | null {
    return (entries.value as Map<keyof E, Entry<E>>).get(field) ?? null;
  }

  function stopTimer(field: keyof E): void {
    const timer = timers.get(field);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(field);
  }

  /**
   * The base with every kept edit laid over it.
   *
   * A pending edit and a refused one are both shown: the first because it is
   * about to be true, the second because the person has not yet said whether
   * to send it again.
   */
  function overlay(base: E): E {
    let out: E = base;
    for (const entry of (entries.value as Map<keyof E, Entry<E>>).values()) {
      out = { ...out, ...entry.change };
    }
    return out;
  }

  /**
   * Run a save of `change`, showing it from now until the answer.
   *
   * `run` says what happened: true when the write landed, false when its
   * refusal has been handled somewhere else on the page — a stale alert, a
   * branch this server does not hold — and a throw for a failure nobody else
   * has said, which is kept here with the server's words. A second save of the
   * same field while one is out replaces it; an answer to the first no longer
   * changes anything.
   */
  async function attempt(change: Partial<E>, run: () => Promise<boolean>): Promise<boolean> {
    const fields = fieldsOf(change);
    if (fields.length === 0) return run();
    attempts += 1;
    const attempt = attempts;
    for (const field of fields) {
      stopTimer(field);
      set(field, { change, attempt, saving: true, slow: false, failure: null });
      timers.set(
        field,
        setTimeout(() => {
          const current = get(field);
          if (current?.attempt === attempt) set(field, { ...current, slow: true });
        }, slowAfter),
      );
    }

    const mine = (field: keyof E): Entry<E> | null => {
      const current = get(field);
      return current?.attempt === attempt ? current : null;
    };

    try {
      const landed = await run();
      // Landed, or handled: either way the overlay comes off, since the page
      // now shows what the file says — the new value, or theirs.
      for (const field of fields) {
        if (mine(field) !== null) {
          stopTimer(field);
          set(field, null);
        }
      }
      return landed;
    } catch (error) {
      const described = describeApiError(error);
      const failure: SaveFailure = {
        heading: errorHeading(described.code),
        message: [described.message, ...described.details].join(" — "),
      };
      for (const field of fields) {
        const current = mine(field);
        if (current === null) continue;
        stopTimer(field);
        set(field, { ...current, saving: false, slow: false, failure });
      }
      return false;
    }
  }

  /** Forget what is kept for the fields `change` names: a save that turned out to change nothing. */
  function settle(change: Partial<E>): void {
    for (const field of fieldsOf(change)) {
      stopTimer(field);
      set(field, null);
    }
  }

  function discard(field: keyof E): void {
    const current = get(field);
    if (current === null) return;
    settle(current.change);
  }

  function retry(field: keyof E): void {
    const current = get(field);
    if (current === null || current.failure === null) return;
    void opts.resend(current.change);
  }

  /** One field's save, live: read it in a template and it follows the entry. */
  function field(name: keyof E): FieldSave {
    const entry = get(name);
    return {
      saving: entry?.saving ?? false,
      slow: entry?.slow ?? false,
      failure: entry?.failure ?? null,
      retry: () => retry(name),
      discard: () => discard(name),
    };
  }

  return {
    overlay,
    attempt,
    settle,
    field,
    /** True while any save is out. */
    saving: computed(() =>
      [...(entries.value as Map<keyof E, Entry<E>>).values()].some((entry) => entry.saving),
    ),
  };
}
