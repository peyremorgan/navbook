/**
 * What a page does with an edit the server refused as stale.
 *
 * Both detail pages save one field at a time, from the rendered value, and
 * the server refuses a save whose field somebody else changed first. The
 * refused edit is the only copy of what was typed — the field editors close
 * on save — so it is kept here, the page is fetched again to show what the
 * file says now, and the decision is the person's: send it again over theirs,
 * or leave theirs. Nothing here picks one (spec 06 §6.3).
 *
 * The kept edit outlives other saves. Somebody who was refused on the title
 * may well set a label while deciding, and that save landing is no answer to
 * the question the alert asks; only a save that names the same field settles
 * it, whether it went through or turned out to change nothing.
 */

import { computed, ref } from "vue";
import { describeApiError, staleEdit } from "~/utils/errors";
import type { EntityEdit } from "~/utils/patch";

export interface StaleEdit {
  /** What was typed, as it was sent. */
  change: Partial<EntityEdit>;
  /** The server's own sentence about why. */
  message: string;
  /** The fields it said had moved, as the mutation names them. */
  moved: string[];
}

export interface StaleEditOptions {
  /**
   * Read the page again, so it shows what the file says now.
   *
   * Typed as Apollo's `refetch` is: undefined when the query is disabled,
   * which a page with nothing on it to edit never is.
   */
  refetch: () => Promise<unknown> | undefined;
  /** Save the kept edit again, against what the page now shows. */
  resend: (change: Partial<EntityEdit>) => Promise<void>;
}

function fieldsOf(change: Partial<EntityEdit>): string[] {
  return Object.keys(change).filter((key) => change[key as keyof EntityEdit] !== undefined);
}

export function useStaleEdit(opts: StaleEditOptions) {
  const stale = ref<StaleEdit | null>(null);
  const refetching = ref(false);

  /** Forget the kept edit once a save names the same field, whatever it did. */
  function settle(change: Partial<EntityEdit>): void {
    const kept = stale.value;
    if (kept === null) return;
    const answered = new Set(fieldsOf(kept.change));
    if (fieldsOf(change).some((field) => answered.has(field))) stale.value = null;
  }

  /**
   * Run a save. True when it landed.
   *
   * A stale refusal is kept and answered with a refetch; any other failure is
   * the caller's, and is rethrown untouched. The refetch's own failure is
   * swallowed because the page already reports a read that failed, and the
   * alert must stay up either way.
   */
  async function attempt(change: Partial<EntityEdit>, send: () => Promise<boolean>) {
    let landed: boolean;
    try {
      landed = await send();
    } catch (failure) {
      const conflict = staleEdit(describeApiError(failure));
      if (conflict === null) throw failure;
      stale.value = { change, message: conflict.message, moved: conflict.moved };
      refetching.value = true;
      try {
        await opts.refetch();
      } catch {
        // Reported by the page's own query state.
      } finally {
        refetching.value = false;
      }
      return false;
    }
    if (landed) settle(change);
    return landed;
  }

  /**
   * Send the kept edit again, against the version the page now shows.
   *
   * Not while the refetch is still out: the page would still hold the hash
   * that was just refused, and the same save would be refused the same way.
   */
  async function reapply(): Promise<void> {
    const kept = stale.value;
    if (kept === null || refetching.value) return;
    await opts.resend(kept.change);
  }

  function dismiss(): void {
    stale.value = null;
  }

  return {
    stale,
    /** True while the page is being read again, when reapplying would be premature. */
    refetching: computed(() => refetching.value),
    attempt,
    settle,
    reapply,
    dismiss,
  };
}
