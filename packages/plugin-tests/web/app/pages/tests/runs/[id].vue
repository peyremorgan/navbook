<!--
  One run: what was tested, by whom, and every step beside what it recorded —
  recorded here while the run is open and this server can write it.
-->
<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import { pageTitle } from "~/utils/title";
import { TEST_RUN_QUERY } from "../../../graphql/queries";

const route = useRoute();
const id = computed(() => String(route.params.id ?? ""));

const { result, loading, error, refetch } = useQuery(TEST_RUN_QUERY, () => ({ id: id.value }), {
  fetchPolicy: "cache-and-network",
});
const run = computed(() => result.value?.testRun ?? null);
useHead({
  title: computed(() =>
    pageTitle(`Run ${id.value}`, run.value?.plan?.title || run.value?.planSlug || "Tests"),
  ),
});

/** Open, and on a branch this server writes: a pull request read off another branch is not. */
const writable = computed(
  () => run.value !== null && run.value.finished === null && (run.value.pr?.refs.length ?? 0) === 0,
);
</script>

<template>
  <QueryState :loading="loading && run === null" :error="error" @retry="refetch()">
    <div v-if="run" class="space-y-6">
      <nav class="flex items-center gap-2 text-sm text-muted">
        <NuxtLink to="/tests" class="hover:text-default">Tests</NuxtLink>
        <span>/</span>
        <NuxtLink v-if="run.plan" :to="`/tests/${run.plan.slug}`" class="hover:text-default">
          {{ run.plan.title }}
        </NuxtLink>
        <code v-else>{{ run.planSlug }}</code>
        <span>/</span>
        <code>{{ run.id }}</code>
      </nav>

      <div class="flex flex-wrap items-center gap-3">
        <h1 class="text-2xl font-semibold">Run of {{ run.plan?.title || run.planSlug }}</h1>
        <TestStateBadge :state="run.outcome" size="md" data-testid="test-run-outcome" />
      </div>

      <dl class="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
        <dt class="text-muted">Tester</dt>
        <dd><PersonLabel :person="run.author" /></dd>
        <dt class="text-muted">Started</dt>
        <dd><TimeAgo :iso="run.started" /></dd>
        <dt class="text-muted">Finished</dt>
        <dd data-testid="test-run-finished">
          <TimeAgo v-if="run.finished" :iso="run.finished" /><span v-else class="text-muted">not yet</span>
        </dd>
        <template v-if="run.commit">
          <dt class="text-muted">Commit</dt>
          <dd><code>{{ run.commit }}</code></dd>
        </template>
        <template v-if="run.version">
          <dt class="text-muted">Version</dt>
          <dd>{{ run.version }}</dd>
        </template>
        <template v-if="run.environment">
          <dt class="text-muted">Environment</dt>
          <dd>{{ run.environment }}</dd>
        </template>
        <template v-if="run.pr">
          <dt class="text-muted">Pull request</dt>
          <dd>
            <NuxtLink :to="`/prs/${run.pr.id}`" class="hover:underline" data-testid="test-run-pr">
              #{{ run.pr.id }} {{ run.pr.title }}
            </NuxtLink>
            <span v-if="run.pr.refs.length" class="text-muted"> — on {{ run.pr.refs.join(", ") }}</span>
          </dd>
        </template>
        <dt class="text-muted">File</dt>
        <dd><code class="break-all">{{ run.path }}</code></dd>
      </dl>

      <UAlert
        v-if="run.stepsFrom !== 'PLAN_SHA'"
        color="neutral"
        variant="subtle"
        icon="i-lucide-info"
        :description="
          run.stepsFrom === 'TREE'
            ? 'The version of the plan this run followed is not in this repository; its steps are shown as the plan has them now.'
            : 'There is no plan by this name here; only what the run recorded is shown.'
        "
        data-testid="test-run-steps-from"
      />

      <TestRunner :key="run.id" :run="run" :writable="writable" />

      <section v-if="run.attachments.length" class="space-y-2" data-testid="test-run-attachments">
        <h2 class="text-lg font-semibold">Attachments</h2>
        <div class="grid gap-3 sm:grid-cols-2">
          <TestAttachment v-for="file in run.attachments" :key="file.path" :run="run.id" :name="file.name" />
        </div>
      </section>
    </div>
  </QueryState>
</template>
