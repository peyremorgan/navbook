<!--
  An issue's open polls, on its listing row and its inbox row.

  Registered as a row badge, which the host draws on every kind of row; it
  reads `ext`, the one field a row the host fetched carries for a plugin, and
  draws nothing beside a pull request or an issue with no open poll.
-->
<script setup lang="ts">
import { readPollExt } from "../utils/poll";

const props = defineProps<{
  entity: { ext?: Record<string, unknown> | null };
  /** `issue` on an issue listing row, `inbox-row` in the inbox. */
  where: string;
}>();

const open = computed(() =>
  props.where === "pr"
    ? 0
    : readPollExt(props.entity.ext).filter((poll) => poll.status === "open").length,
);
</script>

<template>
  <div v-if="open > 0" class="mt-1.5 flex flex-wrap gap-1" :data-testid="`${props.where}-polls`">
    <UBadge color="primary" variant="subtle" size="sm" icon="i-lucide-vote">
      {{ open === 1 ? "Open poll" : `${open} open polls` }}
    </UBadge>
  </div>
</template>
