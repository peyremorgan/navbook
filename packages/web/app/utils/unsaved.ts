/**
 * What on the page has been typed and not yet saved, and the question asked
 * before leaving it.
 *
 * Each owner of a draft — an editor, a form — holds a predicate here for as
 * long as it is mounted, and the guards (`app/middleware/00.unsaved.global.ts`
 * and `app/plugins/04.unsaved.ts`) ask all of them at once. So there is one
 * question however many drafts a page has, rather than one per editor, and a
 * component that renders a way out (the sidebar, a reference in a preview)
 * needs to know nothing about what the page holds.
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
  /**
   * Leaving has been agreed to already, by a caller that asked for itself:
   * the next guard to run lets it through rather than asking again.
   */
  agree(): void;
  /** Whether leaving was agreed to; reading it spends the agreement. */
  takeAgreement(): boolean;
  /**
   * The dialog's yes to the navigation under way. Until it is over
   * (`endNavigation`), a way out of the document it leads to is not asked
   * about again: `auth.global` may answer it with the redirect to the
   * provider, and the browser's own prompt would then ask the question the
   * person has just answered.
   */
  agreeToNavigation(): void;
  /** That navigation is over, one way or the other; a later one is asked. */
  endNavigation(): void;
  /**
   * Whether the document may go without the browser asking: nothing is
   * unsaved, or leaving was agreed — by a caller that asked for itself, which
   * this spends, or in the dialog for the navigation under way.
   */
  mayUnload(): boolean;
}

export function createUnsavedWork(): UnsavedWork {
  const held = new Set<() => boolean>();
  const asking = ref(false);
  let settle: ((leave: boolean) => void) | null = null;
  // One way out, not every one after it: the drafts are still held, so if
  // that way out never happens — a sign-out that failed — they stay guarded.
  let agreed = false;
  // The navigation agreed to in the dialog is still under way. Not spent
  // like `agreed`, since nothing says how often the browser consults the
  // guard before the page goes; lowered instead when the navigation is over,
  // or every later reload would go unasked.
  let navigating = false;

  function dirty(): boolean {
    for (const isDirty of held) if (isDirty()) return true;
    return false;
  }

  function takeAgreement(): boolean {
    const was = agreed;
    agreed = false;
    return was;
  }

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
    dirty,
    asking,
    confirmLeave() {
      // A second question replaces the first: whatever it was about has been
      // superseded, so it has nobody left to answer to.
      answer(false);
      asking.value = true;
      return new Promise<boolean>((resolve) => {
        settle = resolve;
      });
    },
    answer,
    agree() {
      agreed = true;
    },
    takeAgreement,
    agreeToNavigation() {
      navigating = true;
    },
    endNavigation() {
      navigating = false;
    },
    mayUnload() {
      return takeAgreement() || navigating || !dirty();
    },
  };
}
