<!--
  A poll in the discussion, where it was asked.

  Registered as a timeline item: the issue page places it by the time in the
  issue's `ext` and hands over its key, and this fetches the poll as the
  person looking sees it — their ballot is not in `ext`, which is the same
  for everybody.
-->
<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import { describeApiError } from "~/utils/errors";
import { POLL_QUERY } from "../graphql/queries";

const props = defineProps<{ itemKey: string; entityId: string }>();

const { result, error, loading, refetch } = useQuery(POLL_QUERY, () => ({ id: props.itemKey }), {
  fetchPolicy: "cache-and-network",
});
const poll = computed(() => result.value?.poll ?? null);
/**
 * Gone, rather than unreadable: the issue's `ext` named a poll the tree no
 * longer has — removed by hand, moved by a sync. Asking again cannot help.
 */
const gone = computed(
  () => error.value != null && describeApiError(error.value).code === "NOT_FOUND",
);
</script>

<template>
  <PollCard v-if="poll" :poll="poll" @reload="refetch()" />
  <UCard v-else-if="gone || (!error && !loading)" :data-testid="`poll-card-${props.itemKey}`">
    <p class="text-sm text-muted">Poll {{ props.itemKey }} is not in this tree any more.</p>
  </UCard>
  <UCard v-else-if="error" :data-testid="`poll-card-${props.itemKey}`">
    <UAlert
      color="error"
      variant="subtle"
      icon="i-lucide-circle-x"
      title="This poll could not be read"
      :description="error.message"
      :actions="[{ label: 'Retry', onClick: () => void refetch() }]"
    />
  </UCard>
  <USkeleton v-else class="h-32 w-full" />
</template>
