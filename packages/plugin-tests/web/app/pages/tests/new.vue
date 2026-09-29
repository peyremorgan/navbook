<!--
  A new test plan, written as fields.
-->
<script setup lang="ts">
import { pageTitle } from "~/utils/title";

useHead({ title: pageTitle("New test plan", "Tests") });

const mutations = useTestMutations();
// Unmounted before leaving, so the editor's unsaved-work guard does not ask
// about a draft that has just been saved.
const done = ref(false);

async function save(plan: {
  title: string;
  slug: string | null;
  description: string;
  steps: { title: string; actions: string; expected: string | null }[];
}): Promise<void> {
  const payload = await mutations.createPlan(plan);
  if (!payload) return;
  done.value = true;
  await nextTick();
  await navigateTo(`/tests/${payload.plan.slug}`);
}
</script>

<template>
  <div class="space-y-4">
    <nav class="flex items-center gap-2 text-sm text-muted">
      <NuxtLink to="/tests" class="hover:text-default">Tests</NuxtLink>
      <span>/</span>
      <span>New plan</span>
    </nav>
    <h1 class="text-xl font-semibold">New test plan</h1>
    <TestPlanEditor v-if="!done" :saving="mutations.busy.value" @save="save" @cancel="navigateTo('/tests')" />
  </div>
</template>
