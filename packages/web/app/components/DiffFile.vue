<!--
  One file of a diff: its header, and its hunks as a table of rows.

  Built for the size of diff a reviewer actually meets. The rows are plain
  table rows made in one `v-for` rather than a component apiece — GitHub's
  own rewrite of this view found the components per line, not the lines, were
  what made a large diff slow — and the whole file is under
  `content-visibility: auto`, so a file scrolled out of view costs no layout
  and no paint until it is scrolled back. The size it would take is given
  from the row count, so the scrollbar is honest before the rows are laid out.

  What the server withheld is asked for here, by path, when somebody wants
  it: a file past the size budget shows its counts and a button, which is
  the "Load diff" every forge has. Collapsing a file is local and remembers
  nothing, because a diff is read once.
-->
<script setup lang="ts">
import { countsLabel, type DiffRow, estimatedHeight, parseHunks } from "~/utils/diff";
import type { ChangedFileFieldsFragment, ChangeStatus } from "~~/src/generated/gql/graphql";

const props = defineProps<{
  file: ChangedFileFieldsFragment;
  /** Where this file sits in the listing, for the anchor the file list points at. */
  index: number;
  /** True while the patch this file lacks is on its way. */
  loading?: boolean;
}>();

const emit = defineEmits<{ load: [path: string] }>();

const collapsed = ref(false);

/**
 * Split once, when first shown; a collapsed file is not split at all.
 *
 * `markRaw`, because the rows are read and never written: five thousand of
 * them behind a reactive proxy would cost a trap per property per row for
 * nothing.
 */
const rows = computed<DiffRow[]>(() =>
  collapsed.value || props.file.patch === null ? [] : markRaw(parseHunks(props.file.patch)),
);

/**
 * An approximate height for the browser to reserve while the rows are skipped
 * or not yet made, from the line count the server sent: honest before any
 * parsing, so the scrollbar does not jump as files below the fold fill in.
 */
const reserved = computed(() => `auto ${estimatedHeight(props.file, collapsed.value)}px`);

const STATUS: Record<ChangeStatus, { letter: string; label: string; color: string }> = {
  ADDED: { letter: "A", label: "added", color: "text-success" },
  MODIFIED: { letter: "M", label: "modified", color: "text-warning" },
  DELETED: { letter: "D", label: "deleted", color: "text-error" },
  RENAMED: { letter: "R", label: "renamed", color: "text-info" },
  COPIED: { letter: "C", label: "copied", color: "text-info" },
};

const ROW_CLASS: Record<DiffRow["kind"], string> = {
  hunk: "bg-elevated text-muted",
  context: "",
  add: "bg-success/10",
  del: "bg-error/10",
  note: "text-muted italic",
};

const MARKER: Record<DiffRow["kind"], string> = {
  hunk: "",
  context: " ",
  add: "+",
  del: "−",
  note: "",
};

const before = (row: DiffRow): string => (row.mark ? row.text.slice(0, row.mark[0]) : row.text);
const within = (row: DiffRow): string => (row.mark ? row.text.slice(row.mark[0], row.mark[1]) : "");
const after = (row: DiffRow): string => (row.mark ? row.text.slice(row.mark[1]) : "");

/** What the body says when there are no rows to show. */
const empty = computed<string | null>(() => {
  if (props.file.binary) return "Binary file, not shown.";
  if (props.file.patch !== null || props.file.lines > 0) return null;
  switch (props.file.status) {
    case "ADDED":
      return "Empty file added.";
    case "DELETED":
      return "Empty file deleted.";
    case "RENAMED":
      return "Renamed without changes.";
    case "COPIED":
      return "Copied without changes.";
    default:
      return "No content change.";
  }
});
</script>

<template>
  <section
    :id="`file-${index}`"
    class="diff-file rounded-md border border-default"
    :style="{ containIntrinsicSize: reserved }"
    :data-testid="`diff-file-${file.path}`"
  >
    <header
      class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-default bg-elevated px-3 py-2 text-sm"
    >
      <!--
        Plain elements throughout the header, on purpose: a diff can have
        thousands of files, and a component per header — a UButton is a few
        hundred nodes of its own to make — was measured at whole seconds
        before the first paint of a 2,800-file diff.
      -->
      <button
        type="button"
        class="rounded px-1 text-muted hover:bg-accented hover:text-default"
        :aria-label="collapsed ? 'Expand' : 'Collapse'"
        :aria-expanded="!collapsed"
        @click="collapsed = !collapsed"
      >
        <span aria-hidden="true">{{ collapsed ? "▸" : "▾" }}</span>
      </button>
      <span
        class="font-mono text-xs font-semibold"
        :class="STATUS[file.status].color"
        :title="STATUS[file.status].label"
      >
        {{ STATUS[file.status].letter }}
      </span>
      <code class="break-all">
        <template v-if="file.oldPath !== null">{{ file.oldPath }} → </template>{{ file.path }}
      </code>
      <span class="ms-auto whitespace-nowrap font-mono text-xs text-muted">
        <span class="text-success">+{{ file.additions }}</span>
        <span class="text-error"> −{{ file.deletions }}</span>
      </span>
    </header>

    <div v-if="!collapsed">
      <p v-if="empty !== null" class="px-3 py-3 text-sm text-muted">{{ empty }}</p>

      <div v-else-if="file.patch === null" class="flex items-center gap-3 px-3 py-3 text-sm text-muted">
        <span>Large diff not shown by default ({{ countsLabel(file.additions, file.deletions) }}, {{ file.lines }} lines).</span>
        <button
          type="button"
          class="rounded-md border border-default bg-elevated px-2 py-1 text-xs font-medium text-default hover:bg-accented disabled:opacity-60"
          :disabled="loading"
          :data-testid="`load-diff-${file.path}`"
          @click="emit('load', file.path)"
        >
          {{ loading ? "Loading…" : "Load diff" }}
        </button>
      </div>

      <div v-else class="overflow-x-auto">
        <table class="diff-table w-full font-mono text-xs">
          <tbody>
            <tr v-for="(row, i) in rows" :key="i" :class="ROW_CLASS[row.kind]">
              <template v-if="row.kind === 'hunk'">
                <td colspan="4" class="px-3 py-1">{{ row.text }}</td>
              </template>
              <template v-else>
                <td class="num">{{ row.oldNo }}</td>
                <td class="num">{{ row.newNo }}</td>
                <td class="marker">{{ MARKER[row.kind] }}</td>
                <td class="code">
                  <template v-if="row.mark">
                    {{ before(row) }}<mark :class="row.kind === 'add' ? 'bg-success/25' : 'bg-error/25'">{{ within(row) }}</mark>{{ after(row) }}
                  </template>
                  <template v-else>{{ row.text }}</template>
                </td>
              </template>
            </tr>
          </tbody>
        </table>
        <p v-if="file.truncated" class="border-t border-default px-3 py-2 text-xs text-muted">
          Cut at the server's limit: {{ file.lines }} lines in all.
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.diff-file {
  content-visibility: auto;
}

.diff-table td {
  line-height: 20px;
  vertical-align: top;
}

.diff-table .num {
  width: 1%;
  min-width: 3rem;
  padding-inline: 0.5rem;
  text-align: end;
  color: var(--ui-text-muted);
  user-select: none;
}

.diff-table .marker {
  width: 1%;
  padding-inline-start: 0.5rem;
  user-select: none;
}

.diff-table .code {
  padding-inline: 0.5rem;
  white-space: pre;
}

.diff-table mark {
  color: inherit;
  border-radius: 2px;
}
</style>
