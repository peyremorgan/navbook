<script setup lang="ts">
import type { PrListItemFragment } from "~~/src/generated/gql/graphql";

const props = defineProps<{ pr: PrListItemFragment }>();
</script>

<template>
  <NuxtLink
    :to="`/prs/${props.pr.id}`"
    class="flex flex-col gap-1 border-b border-default px-3 py-3 last:border-0 hover:bg-elevated/50"
    :data-testid="`pr-row-${props.pr.id}`"
  >
    <div class="flex flex-wrap items-center gap-2">
      <StatusBadge :status="props.pr.status" :draft="props.pr.draft" />
      <span class="font-medium">{{ props.pr.title }}</span>
      <UBadge v-for="label in props.pr.labels" :key="label" color="primary" variant="soft" size="sm">
        {{ label }}
      </UBadge>
      <ReviewBadge
        :decision="props.pr.reviewDecision"
        :asked="props.pr.reviewers.length > 0"
        :approvals="props.pr.approvals"
      />
    </div>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      <code>#{{ props.pr.id }}</code>
      <span class="inline-flex items-center gap-1">
        <UIcon name="i-lucide-git-merge" class="size-3" />
        <code>{{ props.pr.source ?? "?" }}</code> → <code>{{ props.pr.target }}</code>
      </span>
      <span>opened <TimeAgo :iso="props.pr.created" /> by <PersonLabel :person="props.pr.author" /></span>
      <span v-if="props.pr.refs.length" class="inline-flex items-center gap-1">
        <UIcon name="i-lucide-git-branch" class="size-3" />
        <code v-for="branch in props.pr.refs" :key="branch">{{ branch }}</code>
      </span>
    </div>
  </NuxtLink>
</template>
