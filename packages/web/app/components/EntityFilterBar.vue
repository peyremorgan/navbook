<!--
  The filter, as controls.

  Suggestions come from the listing currently on screen, because there is
  nowhere else they could come from: the format keeps no registry of labels,
  assignees or milestones, and the server introduces none (spec 06 §6.6). So
  the menus are creatable — you can filter by a label no visible entity carries
  — and what they offer is what is in play right now. Features are the one
  exception: they are real directories, so their menu is offered the actual
  list and a caller passes it in.

  Status is chips rather than a menu because there are only ever two or three to
  choose from and it is the filter reached for most. Like every other control
  here, none selected means no narrowing: entities of every status are listed.

  Wide, the bar is three rows: the search box beside the chips, the five menus
  sharing one line in equal parts, then Clear. Equal parts rather than each menu
  sized to what it holds, because a menu's width would then change with every
  value picked and the row would reflow under the pointer. A long selection is
  truncated instead, and the menu says it in full when opened.

  Narrow, those five menus are behind a toggle. Stacked they are five lines of
  controls above the listing — most of a phone — and what is reached for on a
  phone is a status chip or a word in the box. The panel opens itself whenever
  something is narrowing by a menu, since a filter you cannot see is one you
  cannot take off, and it counts what is chosen while it is shut. It is hidden
  with CSS rather than taken away, so the same controls exist at every width and
  a resize needs nothing done about it; whether it is open belongs to this bar
  alone and is remembered nowhere.
-->
<script setup lang="ts">
import { statusLabel } from "~/utils/entities";
import type { FilterState } from "~/utils/filter-params";
import type { Status } from "~~/src/generated/gql/graphql";

const props = defineProps<{
  filter: FilterState;
  statuses: readonly Status[];
  labels: string[];
  assignees: string[];
  authors: string[];
  milestones: string[];
  features: string[];
  empty: boolean;
}>();

const emit = defineEmits<{ patch: [Partial<FilterState>]; clear: [] }>();

/** The search box is local so typing does not rewrite the URL per keystroke. */
const text = ref(props.filter.text);
watch(
  () => props.filter.text,
  (next) => {
    if (next !== text.value) text.value = next;
  },
);

function statusActive(status: Status): boolean {
  return props.filter.status.includes(status);
}

function toggleStatus(status: Status): void {
  const selected = props.filter.status;
  emit("patch", {
    status: statusActive(status)
      ? selected.filter((item) => item !== status)
      : [...selected, status],
  });
}

const menus = computed(() => [
  { key: "labels" as const, label: "Label", icon: "i-lucide-tag", options: props.labels },
  { key: "assignees" as const, label: "Assignee", icon: "i-lucide-user", options: props.assignees },
  { key: "authors" as const, label: "Author", icon: "i-lucide-pen-line", options: props.authors },
  {
    key: "milestones" as const,
    label: "Milestone",
    icon: "i-lucide-flag",
    options: props.milestones,
  },
  { key: "features" as const, label: "Feature", icon: "i-lucide-layers", options: props.features },
]);

/** Values chosen across the menus, which is what the shut toggle reports. */
const menuCount = computed(() =>
  menus.value.reduce((count, menu) => count + props.filter[menu.key].length, 0),
);

/** Whether the menus are shown. Above `md` they always are, and this is idle. */
const menusShown = ref(menuCount.value > 0);

// What is true at the start is true later: above `md` the menus are always
// there, so a window narrowed after one has been used would otherwise hide the
// filter it is applying. It only ever opens — shutting the panel under somebody
// who has just emptied its last menu would take away the control they emptied
// it with.
watch(menuCount, (next, previous) => {
  if (previous === 0 && next > 0) menusShown.value = true;
});

// Both listings can be alive at once across a route change, so these are minted
// rather than written down.
const toggleId = useId();
const menusId = useId();
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center gap-2">
      <UInput
        v-model="text"
        icon="i-lucide-search"
        placeholder="Search title, body and comments"
        class="w-full md:w-auto md:min-w-56 md:flex-1"
        :ui="{ trailing: 'pe-1' }"
        data-testid="filter-text"
        @keydown.enter="emit('patch', { text })"
        @blur="emit('patch', { text })"
      >
        <template v-if="text !== ''" #trailing>
          <UButton
            color="neutral"
            variant="link"
            size="sm"
            icon="i-lucide-x"
            aria-label="Clear the search"
            @click="((text = ''), emit('patch', { text: '' }))"
          />
        </template>
      </UInput>

      <div class="flex items-center gap-1" role="group" aria-label="Status">
        <UButton
          v-for="status in props.statuses"
          :key="status"
          size="sm"
          color="neutral"
          :variant="statusActive(status) ? 'soft' : 'ghost'"
          :aria-pressed="statusActive(status)"
          :data-testid="`filter-status-${status.toLowerCase()}`"
          @click="toggleStatus(status)"
        >
          {{ statusLabel(status) }}
        </UButton>
      </div>

      <UButton
        size="sm"
        color="neutral"
        variant="ghost"
        class="ms-auto md:hidden"
        :trailing-icon="menusShown ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        :aria-expanded="menusShown"
        :aria-controls="menusId"
        data-testid="filter-advanced"
        @click="menusShown = !menusShown"
      >
        <span :id="toggleId">Advanced search</span>
        <template v-if="menuCount > 0">
          <UBadge color="neutral" variant="subtle" size="sm" data-testid="filter-advanced-count">
            {{ menuCount }}
          </UBadge>
          <!-- The number alone says nothing when read out rather than seen. -->
          <span class="sr-only">chosen</span>
        </template>
      </UButton>
    </div>

    <div
      :id="menusId"
      role="group"
      :aria-labelledby="toggleId"
      class="gap-2 md:grid-cols-5"
      :class="menusShown ? 'grid' : 'hidden md:grid'"
    >
      <CreatableSelect
        v-for="menu in menus"
        :key="menu.key"
        :model-value="props.filter[menu.key]"
        :suggestions="menu.options"
        :icon="menu.icon"
        :placeholder="menu.label"
        class="min-w-0"
        :testid="`filter-${menu.key}`"
        @update:model-value="(value: string[]) => emit('patch', { [menu.key]: value })"
      />
    </div>

    <UButton
      v-if="!props.empty"
      size="sm"
      color="neutral"
      variant="ghost"
      icon="i-lucide-filter-x"
      class="self-start"
      data-testid="filter-clear"
      @click="emit('clear')"
    >
      Clear
    </UButton>
  </div>
</template>
