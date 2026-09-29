<!--
  Every test plan, with what its latest run concluded.
-->
<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import { pageTitle } from "~/utils/title";
import { TEST_PLANS_QUERY } from "../../graphql/queries";

useHead({ title: pageTitle("Tests") });

const { result, loading, error, refetch } = useQuery(TEST_PLANS_QUERY, undefined, {
  fetchPolicy: "cache-and-network",
});
const plans = computed(() => result.value?.testPlans ?? []);
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-4">
      <h1 class="text-xl font-semibold">Test plans</h1>
      <UButton icon="i-lucide-plus" to="/tests/new" data-testid="new-test-plan">New plan</UButton>
    </div>
    <QueryState
      :loading="loading && plans.length === 0"
      :error="error"
      :empty="plans.length === 0"
      empty-title="No test plans yet"
      empty-description="A test plan is a list of steps somebody carries out by hand, each an action and what should happen. Runs of it record what did."
      @retry="refetch()"
    >
      <div class="rounded-lg border border-default" data-testid="test-plan-list">
        <TestPlanRow v-for="plan in plans" :key="plan.slug" :plan="plan" />
      </div>
    </QueryState>
  </div>
</template>
