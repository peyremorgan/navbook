<!--
  One run, as a row: what it concluded, who ran it and when, against what.
-->
<script setup lang="ts">
import type { TestRunRowFragment } from "../../src/generated/gql/graphql";

const props = defineProps<{ run: TestRunRowFragment; showPlan?: boolean }>();
</script>

<template>
  <NuxtLink
    :to="`/tests/runs/${props.run.id}`"
    class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-default px-3 py-2 text-sm last:border-0 hover:bg-elevated/50"
    :data-testid="`test-run-row-${props.run.id}`"
  >
    <TestStateBadge :state="props.run.outcome" />
    <span v-if="props.showPlan" class="font-medium">{{ props.run.planSlug }}</span>
    <span class="text-muted"
      ><PersonLabel :person="props.run.author" />, <TimeAgo :iso="props.run.started"
    /></span>
    <code v-if="props.run.commit" class="text-xs text-muted">{{ props.run.commit.slice(0, 12) }}</code>
    <span v-if="props.run.version" class="text-xs text-muted">{{ props.run.version }}</span>
    <code v-if="props.run.pr" class="text-xs text-muted">#{{ props.run.pr.id }}</code>
    <code class="ms-auto text-xs text-muted">{{ props.run.id }}</code>
  </NuxtLink>
</template>
