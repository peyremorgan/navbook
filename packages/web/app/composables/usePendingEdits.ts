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
 *
 * The edits and their states are two stores on purpose. A page's `shown` is a
 * computed over the edits alone, so the timer that turns one field's spinner
 * on does not recompute the page and hand every editor a new value.
 */

import { type ComputedRef, computed, getCurrentScope, onScopeDispose, shallowRef } from "vue";
import { describeApiError, type SaidFailure, sayFailure } from "~/utils/errors";
import { fieldsOf } from "~/utils/patch";

/** How long a save is out before the page admits it is still waiting. */
export const SLOW_SAVE_MS = 1750;

export type SaveFailure = SaidFailure;

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

/** The state of one field's save; the edit itself is kept apart. */
interface State {
  /** Which attempt this is, so a slow answer cannot settle a newer edit. */
  attempt: number;
  saving: boolean;
  slow: boolean;
  failure: SaveFailure | null;
}

export interface PendingEditsOptions<E> {
  /** Save a kept edit again, through the same path the page saves by. */
  resend: (change: Partial<E>) => Promise<void>;
  /**
   * Say a refusal that arrived after the page was left.
   *
   * The field it would have been shown beside is gone with the page, and a
   * refusal nobody hears is the one thing a client of this server must not
   * produce (spec 06 §6.3). A toast is the usual answer.
   */
  lost?: (failure: SaveFailure) => void;
  /** For tests; the default is {@link SLOW_SAVE_MS}. */
  slowAfterMs?: number;
}

export function usePendingEdits<E extends object>(opts: PendingEditsOptions<E>) {
  const slowAfter = opts.slowAfterMs ?? SLOW_SAVE_MS;
  // Shallow, and replaced wholesale on every change: nothing reads a key of
  // either map reactively, and a deep proxy would hand the page's editors
  // proxies of the values they were given.
  const changes = shallowRef(new Map<keyof E, Partial<E>>());
  const states = shallowRef(new Map<keyof E, State>());
  const timers = new Map<keyof E, ReturnType<typeof setTimeout>>();
  const fields = new Map<keyof E, ComputedRef<FieldSave>>();
  let attempts = 0;
  let gone = false;

  /** Every pending timer, dropped with the page: a spinner for nobody. */
  if (getCurrentScope()) {
    onScopeDispose(() => {
      gone = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    });
  }

  function setChange(field: keyof E, change: Partial<E> | null): void {
    const next = new Map(changes.value);
    if (change === null) next.delete(field);
    else next.set(field, change);
    changes.value = next;
  }

  function setState(field: keyof E, state: State | null): void {
    const next = new Map(states.value);
    if (state === null) next.delete(field);
    else next.set(field, state);
    states.value = next;
  }

  function stopTimer(field: keyof E): void {
    const timer = timers.get(field);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(field);
  }

  function forget(field: keyof E): void {
    stopTimer(field);
    setChange(field, null);
    setState(field, null);
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
    for (const change of changes.value.values()) out = { ...out, ...change };
    return out;
  }

  /**
   * The base with only the edits in flight laid over it: what the file is
   * about to say, which is what a new save should be compared against.
   *
   * Against the cache alone, typing the old value back while the new one is
   * still out would look like no change, and the revert would never be sent.
   * A refused edit is left out: the file does not hold it, so saving it again
   * is a change worth sending.
   */
  function basis(base: E): E {
    let out: E = base;
    for (const [field, change] of changes.value) {
      if (states.value.get(field)?.saving) out = { ...out, ...change };
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
    const named = fieldsOf(change);
    if (named.length === 0) return run();
    attempts += 1;
    const attempt = attempts;
    for (const field of named) {
      stopTimer(field);
      setChange(field, change);
      setState(field, { attempt, saving: true, slow: false, failure: null });
      timers.set(
        field,
        setTimeout(() => {
          const state = states.value.get(field);
          if (state?.attempt === attempt) setState(field, { ...state, slow: true });
        }, slowAfter),
      );
    }

    /** The fields this attempt still owns: a newer save may have taken some. */
    const mine = (): (keyof E)[] =>
      named.filter((field) => states.value.get(field)?.attempt === attempt);

    try {
      const landed = await run();
      // Landed, or handled: either way the overlay comes off, since the page
      // now shows what the file says — the new value, or theirs.
      for (const field of mine()) forget(field);
      return landed;
    } catch (error) {
      const failure = sayFailure(describeApiError(error));
      if (gone) {
        opts.lost?.(failure);
        return false;
      }
      for (const field of mine()) {
        const state = states.value.get(field);
        if (state === undefined) continue;
        stopTimer(field);
        setState(field, { ...state, saving: false, slow: false, failure });
      }
      return false;
    }
  }

  /**
   * Forget a refused edit of the fields `change` names, because a save just
   * said what the file already says. A save still in flight is left alone:
   * saying its value again is not an answer to it.
   */
  function settle(change: Partial<E>): void {
    for (const field of fieldsOf(change)) {
      if (states.value.get(field)?.saving) continue;
      forget(field);
    }
  }

  function discard(field: keyof E): void {
    const change = changes.value.get(field);
    if (change !== undefined) settle(change);
  }

  function retry(field: keyof E): void {
    const change = changes.value.get(field);
    if (change === undefined || states.value.get(field)?.failure == null) return;
    void opts.resend(change);
  }

  /**
   * One field's save, live.
   *
   * Cached per field, so a page handing it to an editor hands the same object
   * until that field's state changes, and the editor is not re-rendered for a
   * spinner on some other field.
   */
  function field(name: keyof E): FieldSave {
    let live = fields.get(name);
    if (live === undefined) {
      // The map is replaced for any field's change, so the computed runs for
      // all of them; it hands back the object it made last time unless this
      // field's own state — itself replaced, never mutated — is a new one.
      let last: { state: State | undefined; save: FieldSave } | null = null;
      live = computed<FieldSave>(() => {
        const state = states.value.get(name);
        if (last !== null && last.state === state) return last.save;
        const save: FieldSave = {
          saving: state?.saving ?? false,
          slow: state?.slow ?? false,
          failure: state?.failure ?? null,
          retry: () => retry(name),
          discard: () => discard(name),
        };
        last = { state, save };
        return save;
      });
      fields.set(name, live);
    }
    return live.value;
  }

  return {
    overlay,
    basis,
    attempt,
    settle,
    field,
    /** True while any save is out. */
    saving: computed(() => [...states.value.values()].some((state) => state.saving)),
    /** True while any edit is kept: out, or refused and not yet answered. */
    pending: computed(() => changes.value.size > 0),
  };
}
