/**
 * Placing an issue by dragging it, and by keyboard.
 *
 * The arithmetic is the whole design (spec 02 §2.5). A drop between two ranked
 * rows takes the value halfway between theirs, and one past either end takes a
 * value clear of it, so placing an issue rewrites *one file*. Renumbering the
 * listing so the values stayed tidy would touch every file in it — the central
 * index of spec 06 §6.6, spread out rather than gathered up, and exactly as
 * much of a conflict magnet.
 *
 * The unranked tail cannot be reordered among itself: those rows are in the
 * order they arrived, and there is nothing to place one between. Dropping into
 * it places the row last of everything that has been ranked, which is the only
 * reading that means anything.
 *
 * Dragging is native, on a handle that is also a button, so the same move is
 * Space, arrow keys, Space. That is not decoration: a listing you can only
 * reorder with a pointer is one half the people using it cannot reorder at all.
 *
 * Nothing here is optimistic about the *values*. The preview moves the row
 * while a drop is in flight, and when the write lands the cache holds the new
 * rank and the sort puts the row exactly where the preview already had it. A
 * write that fails leaves the preview behind and the row springs back, which is
 * the truth: the file did not change.
 */

import type { InboxItem } from "~/utils/inbox";

/** How far clear of the end of the queue a row dropped past it is placed. */
const STEP = 10;

/** Where a row would land relative to the one under the pointer. */
export type Edge = "before" | "after";

/** What one row needs to know about a reorder in progress. */
export interface ReorderRow {
  /** This row is the one being moved. */
  lifted: boolean;
  /** Draw the drop line above or below it, or not at all. */
  edge: Edge | null;
  /** Whether this row can be picked up: an issue, while nothing is in flight. */
  draggable: boolean;
}

export interface InboxReorderHandle {
  /** The rows to render: what was given, with any move in progress applied. */
  items: ComputedRef<InboxItem[]>;
  rowState: (item: InboxItem) => ReorderRow;
  /** True while a write is in flight; every handle is inert until it lands. */
  busy: ComputedRef<boolean>;
  /** What a screen reader is told, as it happens. */
  announcement: Ref<string>;
  onDragStart: (item: InboxItem, event: DragEvent) => void;
  onDragOver: (item: InboxItem, event: DragEvent) => void;
  onDragLeave: (item: InboxItem) => void;
  onDrop: (item: InboxItem, event: DragEvent) => void;
  onDragEnd: () => void;
  onHandleKey: (item: InboxItem, event: KeyboardEvent) => void;
}

/** A row's rank, and null for anything that has none — a pull request included. */
function rankOf(item: InboxItem): number | null {
  if (item.kind !== "issue") return null;
  const rank = item.entity.rank;
  return typeof rank === "number" && Number.isFinite(rank) ? rank : null;
}

/**
 * The rank that puts a row at `index` of `rest`, which is the list without it.
 *
 * Between two ranked neighbours, halfway. Past the last ranked row, a step
 * beyond it — which is also the answer for a drop anywhere in the unranked
 * tail, since there is nothing there to sit between. Above the first, a step
 * before it. In a listing where nothing is ranked at all, the first step.
 */
export function rankForPosition(rest: readonly InboxItem[], index: number): number {
  // Clamped here rather than trusted from the caller: a negative index would
  // otherwise slice from the end, and a row dropped at the top of the list
  // would be given a rank from somewhere near the bottom of it.
  const at = Math.min(Math.max(index, 0), rest.length);
  const above = rest
    .slice(0, at)
    .map(rankOf)
    .filter((rank) => rank !== null);
  const below = rest
    .slice(at)
    .map(rankOf)
    .filter((rank) => rank !== null);
  const previous = above.at(-1) ?? null;
  const next = below[0] ?? null;

  if (previous !== null && next !== null) return (previous + next) / 2;
  if (previous !== null) return previous + STEP;
  if (next !== null) return next - STEP;
  return STEP;
}

type Mode =
  | { kind: "idle" }
  | { kind: "pointer"; key: string }
  | { kind: "keyboard"; key: string; index: number };

/** An item's identity across a refetch; two kinds could share an id. */
const keyOf = (item: InboxItem): string => `${item.kind}:${item.id}`;

export function useInboxReorder(
  shown: ComputedRef<InboxItem[]>,
  enabled: ComputedRef<boolean>,
  commit: (id: string, rank: number) => Promise<boolean>,
): InboxReorderHandle {
  const mode = ref<Mode>({ kind: "idle" });
  const over = ref<{ key: string; edge: Edge } | null>(null);
  /** Where a row is being shown while its write is in flight. */
  const pending = ref<{ key: string; index: number } | null>(null);
  const announcement = ref("");

  const busy = computed(() => pending.value !== null);

  const reset = (): void => {
    mode.value = { kind: "idle" };
    over.value = null;
  };

  /** The list with one row taken out and put back at `index`. */
  const moved = (rows: InboxItem[], key: string, index: number): InboxItem[] => {
    const from = rows.findIndex((row) => keyOf(row) === key);
    if (from === -1) return rows;
    const rest = [...rows];
    const [lifted] = rest.splice(from, 1);
    if (lifted === undefined) return rows;
    rest.splice(Math.min(Math.max(index, 0), rest.length), 0, lifted);
    return rest;
  };

  /*
   * What to draw. A keyboard move shows where the row would land as the arrows
   * are pressed, and a write in flight keeps it there until the answer arrives
   * — which is what stops a row jumping back to where it was for the moment
   * between the click and the commit.
   */
  const items = computed(() => {
    const rows = shown.value;
    const held = mode.value;
    if (held.kind === "keyboard") return moved(rows, held.key, held.index);
    const inFlight = pending.value;
    if (inFlight !== null) return moved(rows, inFlight.key, inFlight.index);
    return rows;
  });

  // A row that leaves the listing under a keyboard move — a refetch, a filter,
  // somebody else closing it — takes the move with it rather than leaving a
  // handle that says it is holding something that is not there.
  watch(items, (rows) => {
    const held = mode.value;
    if (held.kind === "idle") return;
    if (!rows.some((row) => keyOf(row) === held.key)) reset();
  });

  const rowState = (item: InboxItem): ReorderRow => {
    const held = mode.value;
    const lifted = held.kind !== "idle" && held.key === keyOf(item);
    const marker = over.value;
    return {
      lifted,
      edge: marker !== null && marker.key === keyOf(item) && !lifted ? marker.edge : null,
      draggable: enabled.value && item.kind === "issue" && !busy.value,
    };
  };

  /**
   * Place `key` at `index` of the list without it, and record the new rank.
   *
   * A move that changes nothing is not a write: dropping a row on itself, or
   * where the arithmetic hands back the rank it already had, leaves the file
   * alone rather than committing a diff nobody asked for.
   */
  const place = async (key: string, index: number): Promise<void> => {
    const rows = shown.value;
    const from = rows.findIndex((row) => keyOf(row) === key);
    const item = rows[from];
    reset();
    if (item === undefined || item.kind !== "issue") return;

    const rest = rows.filter((row) => keyOf(row) !== key);
    const target = Math.min(Math.max(index, 0), rest.length);
    if (target === from) return;

    const rank = rankForPosition(rest, target);
    if (rank === rankOf(item)) return;

    pending.value = { key, index: target };
    announcement.value = `Moved ${item.entity.title} to position ${target + 1} of ${rows.length}.`;
    const saved = await commit(item.id, rank);
    pending.value = null;
    if (!saved) announcement.value = `${item.entity.title} could not be moved.`;
  };

  /** Where a drop on `item` would put the row, given which half was hovered. */
  const indexFor = (item: InboxItem, edge: Edge): number => {
    const rows = shown.value;
    const held = mode.value;
    const rest = rows.filter((row) => held.kind === "idle" || keyOf(row) !== held.key);
    const at = rest.findIndex((row) => keyOf(row) === keyOf(item));
    if (at === -1) return rest.length;
    return edge === "before" ? at : at + 1;
  };

  const onDragStart = (item: InboxItem, event: DragEvent): void => {
    if (!rowState(item).draggable) {
      event.preventDefault();
      return;
    }
    mode.value = { kind: "pointer", key: keyOf(item) };
    // Some text has to be set or Firefox refuses to start the drag at all.
    event.dataTransfer?.setData("text/plain", item.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  };

  const onDragOver = (item: InboxItem, event: DragEvent): void => {
    if (mode.value.kind !== "pointer") return;
    // Without this the browser refuses the drop, and `drop` never fires.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const box = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect();
    const edge: Edge =
      box !== undefined && event.clientY > box.top + box.height / 2 ? "after" : "before";
    over.value = { key: keyOf(item), edge };
  };

  const onDragLeave = (item: InboxItem): void => {
    if (over.value?.key === keyOf(item)) over.value = null;
  };

  const onDrop = (item: InboxItem, event: DragEvent): void => {
    event.preventDefault();
    const held = mode.value;
    const marker = over.value;
    if (held.kind !== "pointer") return;
    const index = indexFor(item, marker?.edge ?? "before");
    void place(held.key, index);
  };

  const onDragEnd = (): void => {
    if (mode.value.kind === "pointer") reset();
  };

  /**
   * Space picks a row up and puts it down; the arrows move it in between.
   *
   * The row moves in the preview as the arrows are pressed and is written once,
   * on the second Space — so walking a row down five places is one commit and
   * not five, which is also what a drag does.
   */
  const onHandleKey = (item: InboxItem, event: KeyboardEvent): void => {
    const held = mode.value;
    const rows = shown.value;
    const key = keyOf(item);

    if (event.key === "Escape") {
      if (held.kind === "idle") return;
      event.preventDefault();
      reset();
      announcement.value = `Left ${item.entity.title} where it was.`;
      return;
    }

    if (event.key === " " || event.key === "Spacebar" || event.key === "Enter") {
      event.preventDefault();
      if (held.kind === "keyboard" && held.key === key) {
        void place(key, held.index);
        return;
      }
      if (!rowState(item).draggable) return;
      const index = rows.findIndex((row) => keyOf(row) === key);
      mode.value = { kind: "keyboard", key, index };
      announcement.value =
        `Picked up ${item.entity.title}, position ${index + 1} of ${rows.length}. ` +
        "Use the arrow keys to move it, space to drop it, escape to leave it.";
      return;
    }

    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    if (held.kind !== "keyboard" || held.key !== key) return;
    event.preventDefault();
    const next = Math.min(
      Math.max(held.index + (event.key === "ArrowUp" ? -1 : 1), 0),
      rows.length - 1,
    );
    if (next === held.index) return;
    mode.value = { kind: "keyboard", key, index: next };
    announcement.value = `${item.entity.title}, position ${next + 1} of ${rows.length}.`;
  };

  return {
    items,
    rowState,
    busy,
    announcement,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    onDragEnd,
    onHandleKey,
  };
}
