<!--
  Loading, failed, or empty — the three states every view shares.

  A failure shows what the server said rather than a house sentence: its
  messages name the issue, the prefix, the branch, and are better than anything
  written here could be.
-->
<script setup lang="ts">
import { describeApiError, errorHeading } from "~/utils/errors";

const props = defineProps<{
  loading: boolean;
  error?: unknown;
  /** True when the query succeeded and there is nothing to show. */
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Skeleton rows to draw while the first answer is on its way. */
  skeletonRows?: number;
}>();

const emit = defineEmits<{ retry: [] }>();

const failure = computed(() => (props.error ? describeApiError(props.error) : null));
</script>

<template>
  <UAlert
    v-if="failure"
    color="error"
    variant="subtle"
    icon="i-lucide-triangle-alert"
    :title="errorHeading(failure.code)"
    :actions="[{ label: 'Try again', color: 'neutral', variant: 'subtle', onClick: () => emit('retry') }]"
  >
    <template #description>
      <p>{{ failure.message }}</p>
      <ul v-if="failure.details.length" class="mt-1 list-disc ps-5">
        <li v-for="detail in failure.details" :key="detail">{{ detail }}</li>
      </ul>
    </template>
  </UAlert>

  <div v-else-if="loading" class="space-y-2" data-testid="loading">
    <USkeleton v-for="row in skeletonRows ?? 3" :key="row" class="h-14 w-full" />
  </div>

  <div v-else-if="empty" class="rounded-lg border border-dashed border-default p-10 text-center">
    <p class="font-medium">{{ emptyTitle ?? "Nothing here" }}</p>
    <p class="mt-1 text-sm text-muted">{{ emptyDescription ?? "No entries match this view." }}</p>
    <slot name="empty-actions" />
  </div>

  <slot v-else />
</template>
