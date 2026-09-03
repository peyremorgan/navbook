<script setup lang="ts">
import type { IssueListItemFragment } from "~~/src/generated/gql/graphql";

const props = defineProps<{ issue: IssueListItemFragment }>();
</script>

<template>
  <NuxtLink
    :to="`/issues/${props.issue.id}`"
    class="flex flex-col gap-1 border-b border-default px-3 py-3 last:border-0 hover:bg-elevated/50"
    :data-testid="`issue-row-${props.issue.id}`"
  >
    <div class="flex flex-wrap items-center gap-2">
      <StatusBadge :status="props.issue.status" />
      <span class="font-medium">{{ props.issue.title }}</span>
      <UBadge
        v-for="label in props.issue.labels"
        :key="label"
        color="primary"
        variant="soft"
        size="sm"
      >
        {{ label }}
      </UBadge>
    </div>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      <code>#{{ props.issue.id }}</code>
      <span>opened <TimeAgo :iso="props.issue.created" /> by <PersonLabel :person="props.issue.author" /></span>
      <span v-if="props.issue.assignees.length" class="inline-flex items-center gap-1">
        <UIcon name="i-lucide-user" class="size-3" />
        <PersonLabel
          v-for="assignee in props.issue.assignees"
          :key="assignee"
          :person="assignee"
        />
      </span>
      <span v-if="props.issue.milestone" class="inline-flex items-center gap-1">
        <UIcon name="i-lucide-flag" class="size-3" />{{ props.issue.milestone }}
      </span>
      <span v-if="props.issue.resolution" class="inline-flex items-center gap-1">
        <UIcon name="i-lucide-check" class="size-3" />{{ props.issue.resolution }}
      </span>
    </div>
  </NuxtLink>
</template>
