<!--
  One issue, as a listing row.

  The row is a link, so a badge that is itself a link cannot sit inside it:
  a link inside a link is invalid, and browsers disagree about what to do with
  one. Anything a plugin layer contributes is therefore a sibling of the link
  rather than a part of it, which is why the row is a container holding two
  things instead of being the link itself. Labels stay inert badges — there is
  no page to send those to.
-->
<script setup lang="ts">
import type { IssueListItemFragment } from "~~/src/generated/gql/graphql";

const props = defineProps<{ issue: IssueListItemFragment }>();
const slots = useNavbookSlots();
</script>

<template>
  <div
    class="border-b border-default px-3 py-3 last:border-0 hover:bg-elevated/50"
    :data-testid="`issue-row-${props.issue.id}`"
  >
    <NuxtLink :to="`/issues/${props.issue.id}`" class="flex flex-col gap-1">
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
        <span>
          opened <TimeAgo :iso="props.issue.created" /> by
          <PersonLabel :person="props.issue.author" />
        </span>
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
        <span
          v-if="props.issue.rank !== null && props.issue.rank !== undefined"
          class="inline-flex items-center gap-1"
          data-testid="issue-row-rank"
        >
          <UIcon name="i-lucide-list-ordered" class="size-3" />{{ props.issue.rank }}
        </span>
        <span v-if="props.issue.resolution" class="inline-flex items-center gap-1">
          <UIcon name="i-lucide-check" class="size-3" />{{ props.issue.resolution }}
        </span>
        <DueDate v-if="props.issue.deadline" :deadline="props.issue.deadline" />
      </div>
    </NuxtLink>

    <!-- Outside the link, for the reason given at the top of this file. -->
    <component
      :is="badge.component"
      v-for="(badge, index) in slots.rowBadges()"
      :key="`badge-${index}`"
      :entity="props.issue"
      where="issue"
    />
  </div>
</template>
