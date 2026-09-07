<!--
  One feature, as a listing row.

  What a reader wants to know before opening it is how much is written down and
  how much is still open, so the counts are the row: documents, then work.
-->
<script setup lang="ts">
import type { FeatureListItemFragment } from "~~/src/generated/gql/graphql";

const props = defineProps<{ feature: FeatureListItemFragment }>();

const work = computed(() => [...props.feature.issues, ...props.feature.prs]);
const open = computed(() => work.value.filter((entity) => entity.status === "OPEN").length);
</script>

<template>
  <NuxtLink
    :to="`/features/${props.feature.slug}`"
    class="flex flex-col gap-1 border-b border-default px-3 py-3 last:border-0 hover:bg-elevated/50"
    :data-testid="`feature-row-${props.feature.slug}`"
  >
    <div class="flex flex-wrap items-center gap-2">
      <UIcon name="i-lucide-layers" class="size-4 text-muted" />
      <span class="font-medium">{{ props.feature.title }}</span>
      <code class="text-xs text-muted">{{ props.feature.slug }}</code>
    </div>
    <p v-if="props.feature.summary" class="line-clamp-2 text-sm text-muted">
      {{ props.feature.summary }}
    </p>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      <span class="inline-flex items-center gap-1">
        <UIcon name="i-lucide-file-text" class="size-3" />
        {{ props.feature.specs.length }}
        {{ props.feature.specs.length === 1 ? "document" : "documents" }}
      </span>
      <span class="inline-flex items-center gap-1">
        <UIcon name="i-lucide-circle-dot" class="size-3" />
        {{ open }} open of {{ work.length }}
      </span>
      <span>added <TimeAgo :iso="props.feature.created" /> by
        <PersonLabel :person="props.feature.author" /></span>
    </div>
  </NuxtLink>
</template>
