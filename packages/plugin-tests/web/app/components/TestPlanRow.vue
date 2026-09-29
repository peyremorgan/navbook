<!--
  One plan, as a listing row: how many steps, how often it has been run, and
  what its latest run concluded.
-->
<script setup lang="ts">
import type { TestPlanRowFragment } from "../../src/generated/gql/graphql";
import { passRate } from "../utils/tests";

const props = defineProps<{ plan: TestPlanRowFragment }>();

const latest = computed(() => props.plan.runs[0] ?? null);
const rate = computed(() => passRate(props.plan.stats));
</script>

<template>
  <NuxtLink
    :to="`/tests/${props.plan.slug}`"
    class="flex flex-col gap-1 border-b border-default px-3 py-3 last:border-0 hover:bg-elevated/50"
    :data-testid="`test-plan-row-${props.plan.slug}`"
  >
    <div class="flex flex-wrap items-center gap-2">
      <UIcon name="i-lucide-clipboard-check" class="size-4 text-muted" />
      <span class="font-medium">{{ props.plan.title }}</span>
      <code class="text-xs text-muted">{{ props.plan.slug }}</code>
      <TestStateBadge v-if="latest" :state="latest.outcome" />
    </div>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      <span>{{ props.plan.steps.length }} {{ props.plan.steps.length === 1 ? "step" : "steps" }}</span>
      <span>{{ props.plan.stats.runs }} {{ props.plan.stats.runs === 1 ? "run" : "runs" }}</span>
      <span v-if="rate !== null">{{ rate }}% passed</span>
      <span>written <TimeAgo :iso="props.plan.created" /> by <PersonLabel :person="props.plan.author" /></span>
    </div>
  </NuxtLink>
</template>
