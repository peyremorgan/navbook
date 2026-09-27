/**
 * Declare a draft that leaving would lose, for as long as this component is
 * mounted. `isDirty` is read when a way out is taken, so it should say
 * whether what is on screen differs from what was saved — an editor opened
 * and left untouched is not unsaved work. See `app/utils/unsaved.ts`.
 */
export function useUnsavedWork(isDirty: () => boolean): void {
  const release = useNuxtApp().$unsaved.hold(isDirty);
  onBeforeUnmount(release);
}
