<!--
  Which order the listing is read in — spec 02 §2.5.

  Chips rather than a menu, for the reason the status filter uses them: there
  are three, and an order is something you flip between rather than search for.
  Exactly one is always chosen, so these are radio buttons in behaviour and are
  marked as such; the status chips beside them are toggles and are not.

  The order lives in the query string, like everything else about a view, so it
  is part of what a shared link says.
-->
<script setup lang="ts">
import { SORT_ORDERS, type SortOrder } from "~/utils/sort";

const props = defineProps<{ value: SortOrder }>();
const emit = defineEmits<{ update: [SortOrder] }>();

const LOOK: Record<SortOrder, { label: string; icon: string; title: string }> = {
  priority: {
    label: "Priority",
    icon: "i-lucide-list-ordered",
    title: "Ranked first, then by deadline",
  },
  deadline: {
    label: "Deadline",
    icon: "i-lucide-calendar-clock",
    title: "Soonest first, undated last",
  },
  newest: { label: "Newest", icon: "i-lucide-clock", title: "Most recently filed first" },
};

const orders = computed(() => SORT_ORDERS.map((order) => ({ order, ...LOOK[order] })));
</script>

<template>
  <div class="flex items-center gap-1" role="radiogroup" aria-label="Sort">
    <UButton
      v-for="entry in orders"
      :key="entry.order"
      size="sm"
      color="neutral"
      :variant="props.value === entry.order ? 'soft' : 'ghost'"
      :icon="entry.icon"
      role="radio"
      :aria-checked="props.value === entry.order"
      :title="entry.title"
      :data-testid="`sort-${entry.order}`"
      @click="emit('update', entry.order)"
    >
      {{ entry.label }}
    </UButton>
  </div>
</template>
