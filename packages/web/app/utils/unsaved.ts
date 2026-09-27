/**
 * What on the page has been typed and not yet saved, and the question asked
 * before leaving it.
 *
 * Each owner of a draft — an editor, a form — holds a predicate here for as
 * long as it is mounted, and the guards (`app/plugins/04.unsaved.ts`) ask
 * all of them at once. So there is one question however many drafts a page
 * has, rather than one per editor, and a component that renders a way out
 * (the sidebar, a reference in a preview) needs to know nothing about what
 * the page holds.
 *
 * A predicate rather than a flag, so the answer is read at the moment of
 * leaving: a draft typed back to what was saved is not unsaved work, and no
 * owner has to remember to lower a flag it raised.
 */

import { type Ref, ref } from "vue";

export interface UnsavedWork {
  /** Register a draft's predicate; the returned function lets go of it. */
  hold(isDirty: () => boolean): () => void;
  /** Whether anything held is unsaved right now. */
  dirty(): boolean;
  /** True while the question is on screen, which is what shows the dialog. */
  readonly asking: Readonly<Ref<boolean>>;
  /** Ask whether to leave; resolves true to go, false to stay. */
  confirmLeave(): Promise<boolean>;
  /** The dialog's answer to the question being asked. */
  answer(leave: boolean): void;
  /** Let go of every draft, once leaving them has been agreed elsewhere. */
  discard(): void;
}

export function createUnsavedWork(): UnsavedWork {
  const held = new Set<() => boolean>();
  const asking = ref(false);
  let settle: ((leave: boolean) => void) | null = null;

  function answer(leave: boolean): void {
    const pending = settle;
    settle = null;
    asking.value = false;
    pending?.(leave);
  }

  return {
    hold(isDirty) {
      // Wrapped, so holding the same function twice is two holds and letting
      // go of one leaves the other.
      const entry = () => isDirty();
      held.add(entry);
      return () => {
        held.delete(entry);
      };
    },
    dirty: () => [...held].some((isDirty) => isDirty()),
    asking,
    confirmLeave() {
      // A second way out taken while the first is being asked about replaces
      // it: the router has already cancelled the older navigation, so the
      // older question has nobody left to answer to.
      answer(false);
      asking.value = true;
      return new Promise<boolean>((resolve) => {
        settle = resolve;
      });
    },
    answer,
    discard() {
      held.clear();
    },
  };
}
