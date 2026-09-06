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
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <UInput
      v-model="text"
      icon="i-lucide-search"
      placeholder="Search title, body and comments"
      class="min-w-56 flex-1"
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

    <CreatableSelect
      v-for="menu in menus"
      :key="menu.key"
      :model-value="props.filter[menu.key]"
      :suggestions="menu.options"
      :icon="menu.icon"
      :placeholder="menu.label"
      class="min-w-36"
      :testid="`filter-${menu.key}`"
      @update:model-value="(value: string[]) => emit('patch', { [menu.key]: value })"
    />

    <UButton
      v-if="!props.empty"
      size="sm"
      color="neutral"
      variant="ghost"
      icon="i-lucide-filter-x"
      data-testid="filter-clear"
      @click="emit('clear')"
    >
      Clear
    </UButton>
  </div>
</template>
