<!--
  A deadline, read against today.

  "due in 3 days" rather than the date itself, because what a reader wants from
  a row is how much time is left; the date is in the title for when they want
  the day. Overdue is the one state worth a colour, since it is the one that
  asks for something.

  Today is read once, when the component is set up. The bundle is static and
  the page is not long-lived enough for a badge to go stale, and re-reading the
  clock on every render would make the same row render differently for no
  reason anybody could see.
-->
<script setup lang="ts">
import { absoluteDate, dueLabel, localToday } from "~/utils/dates";

const props = defineProps<{ deadline: string }>();

const today = localToday();
const due = computed(() => dueLabel(props.deadline, today));
</script>

<template>
  <UBadge
    :color="due.overdue ? 'error' : 'neutral'"
    variant="subtle"
    size="sm"
    icon="i-lucide-calendar"
    :data-testid="due.overdue ? 'due-date-overdue' : 'due-date'"
  >
    <time :datetime="props.deadline" :title="absoluteDate(props.deadline)">{{ due.text }}</time>
  </UBadge>
</template>
