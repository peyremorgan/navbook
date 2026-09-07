<!--
  The three questions the inbox can be narrowed by.

  Single-select rather than a set of checkboxes: an inbox is small, and what
  somebody wants from it is "just the reviews" or "just the issues", not an
  arbitrary union. Each group therefore has an entry meaning "no narrowing by
  this", which is where it starts.

  Every entry carries what it would show if it were chosen, counted with the
  other two groups still applied. That is what makes a count worth printing —
  it is a promise about the click, so it has to be counted the way the click
  will be — and it means the rail doubles as the shape of somebody's week.

  A rail beside the list above `md`, the same buttons wrapped into rows of
  chips below it. One DOM at every width, laid out by CSS, so a resize needs
  nothing done about it and nothing can be on screen at one size and gone at
  another. The headings go with the rail: stacked chips read as three rows of
  buttons, and each carries an icon that says which group it belongs to.
-->
<script setup lang="ts">
import {
  type InboxKindChoice,
  type InboxSelection,
  type InboxView,
  type RailCounts,
  type RailEntry,
  sameFeature,
} from "~/utils/inbox";

const props = defineProps<{ counts: RailCounts; selection: InboxSelection }>();
const emit = defineEmits<{ select: [Partial<InboxSelection>] }>();

const VIEW_LOOK: Record<InboxView, { label: string; icon: string }> = {
  everything: { label: "Everything", icon: "i-lucide-inbox" },
  assigned: { label: "Assigned to me", icon: "i-lucide-user" },
  authored: { label: "Authored by me", icon: "i-lucide-pen-line" },
  reviews: { label: "Review requested", icon: "i-lucide-eye" },
};

const KIND_LOOK: Record<InboxKindChoice, { label: string; icon: string }> = {
  any: { label: "Anything", icon: "i-lucide-list" },
  issue: { label: "Issues", icon: "i-lucide-circle-dot" },
  pr: { label: "Pull requests", icon: "i-lucide-git-pull-request" },
};

interface Choice {
  testid: string;
  label: string;
  icon: string;
  count: number;
  active: boolean;
  patch: Partial<InboxSelection>;
}

interface Group {
  heading: string;
  choices: Choice[];
}

const featureChoice = (entry: RailEntry<string | null>): Choice => ({
  testid: `inbox-feature-${entry.value ?? "any"}`,
  label: entry.value ?? "Any feature",
  icon: "i-lucide-layers",
  count: entry.count,
  active:
    entry.value === null
      ? props.selection.feature === null
      : props.selection.feature !== null && sameFeature(props.selection.feature, entry.value),
  patch: { feature: entry.value },
});

const groups = computed<Group[]>(() => [
  {
    heading: "Show",
    choices: props.counts.views.map((entry) => ({
      testid: `inbox-view-${entry.value}`,
      ...VIEW_LOOK[entry.value],
      count: entry.count,
      active: props.selection.view === entry.value,
      patch: { view: entry.value },
    })),
  },
  {
    heading: "Kind",
    choices: props.counts.kinds.map((entry) => ({
      testid: `inbox-kind-${entry.value}`,
      ...KIND_LOOK[entry.value],
      count: entry.count,
      active: props.selection.kind === entry.value,
      patch: { kind: entry.value },
    })),
  },
  // Nothing to choose between when the inbox names no feature at all.
  ...(props.counts.features.length > 1
    ? [{ heading: "Feature", choices: props.counts.features.map(featureChoice) }]
    : []),
]);
</script>

<template>
  <nav class="flex flex-col gap-3" aria-label="Narrow the inbox" data-testid="inbox-rail">
    <div v-for="group in groups" :key="group.heading" role="group" :aria-label="group.heading">
      <p class="mb-1 hidden text-xs font-semibold uppercase tracking-wide text-muted md:block">
        {{ group.heading }}
      </p>
      <div class="flex flex-wrap gap-1 md:flex-col md:gap-0.5">
        <UButton
          v-for="choice in group.choices"
          :key="choice.testid"
          size="sm"
          color="neutral"
          :variant="choice.active ? 'soft' : 'ghost'"
          :aria-pressed="choice.active"
          :icon="choice.icon"
          :data-testid="choice.testid"
          class="md:justify-between"
          @click="emit('select', choice.patch)"
        >
          <span class="truncate">{{ choice.label }}</span>
          <template #trailing>
            <UBadge
              color="neutral"
              variant="subtle"
              size="sm"
              :data-testid="`${choice.testid}-count`"
            >
              {{ choice.count }}
            </UBadge>
          </template>
        </UButton>
      </div>
    </div>
  </nav>
</template>
