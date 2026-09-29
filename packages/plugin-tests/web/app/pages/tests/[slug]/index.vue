<!--
  One test plan: its steps, its runs, and the editor for both.
-->
<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import type { SaidFailure } from "~/utils/errors";
import { pageTitle } from "~/utils/title";
import { otherRefusal, staleContent } from "../../../composables/useTestMutations";
import { TEST_PLAN_QUERY } from "../../../graphql/queries";
import { passRate } from "../../../utils/tests";

const route = useRoute();
const slug = computed(() => String(route.params.slug ?? ""));
const mutations = useTestMutations();

const { result, loading, error, refetch } = useQuery(
  TEST_PLAN_QUERY,
  () => ({ slug: slug.value }),
  {
    fetchPolicy: "cache-and-network",
  },
);
const plan = computed(() => result.value?.testPlan ?? null);
useHead({ title: computed(() => pageTitle(plan.value?.title || slug.value, "Tests")) });

const editing = ref(false);
const stale = ref<string | null>(null);
const other = ref<SaidFailure | null>(null);
/**
 * The version the editor was opened on, so a save is judged against what the
 * author started from, not against whatever a background refetch brought in
 * since. After a stale refusal it moves to the version now shown beside the
 * draft: saving again is then a choice made with both in view.
 */
const editBase = ref<string | null>(null);

function startEditing(): void {
  if (!plan.value) return;
  editBase.value = plan.value.baseSha;
  stale.value = null;
  other.value = null;
  editing.value = true;
}

function stopEditing(): void {
  editing.value = false;
  stale.value = null;
  other.value = null;
}
const starting = ref(false);
const rate = computed(() => (plan.value ? passRate(plan.value.stats) : null));

async function save(change: {
  title: string;
  description: string;
  steps: { title: string; actions: string; expected: string | null }[];
}): Promise<void> {
  if (!plan.value) return;
  stale.value = null;
  other.value = null;
  try {
    const payload = await mutations.updatePlan({
      slug: plan.value.slug,
      title: change.title,
      description: change.description,
      steps: change.steps,
      baseSha: editBase.value ?? plan.value.baseSha,
    });
    if (payload) stopEditing();
  } catch (failure) {
    other.value = otherRefusal(failure);
    const message = staleContent(failure);
    if (message === null) return;
    // Said before the refetch, so the editor stays open on the draft.
    stale.value = message;
    await refetch();
    editBase.value = plan.value?.baseSha ?? null;
  }
}
</script>

<template>
  <QueryState :loading="loading && plan === null" :error="error" @retry="refetch()">
    <div v-if="plan" class="space-y-6">
      <nav class="flex items-center gap-2 text-sm text-muted">
        <NuxtLink to="/tests" class="hover:text-default">Tests</NuxtLink>
        <span>/</span>
        <code>{{ plan.slug }}</code>
      </nav>

      <div class="flex flex-wrap items-center justify-between gap-2">
        <h1 class="text-2xl font-semibold" data-testid="test-plan-title">{{ plan.title }}</h1>
        <div v-if="!editing" class="flex gap-2">
          <UButton
            icon="i-lucide-play"
            :disabled="plan.steps.length === 0"
            data-testid="run-test-plan"
            @click="starting = true"
          >
            Run this plan
          </UButton>
          <UButton
            icon="i-lucide-pencil"
            color="neutral"
            variant="subtle"
            data-testid="edit-test-plan"
            @click="startEditing"
          >
            Edit
          </UButton>
        </div>
      </div>
      <p class="text-sm text-muted">
        {{ plan.stats.runs }} {{ plan.stats.runs === 1 ? "run" : "runs" }}<template v-if="rate !== null">,
          {{ rate }}% of the finished ones passed</template>. Written <TimeAgo :iso="plan.created" /> by
        <PersonLabel :person="plan.author" />; kept at <code>{{ plan.path }}</code>.
      </p>

      <UAlert
        v-if="other"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-x"
        :title="other.heading"
        :description="other.message"
        data-testid="test-plan-refused"
      />
      <TestPlanEditor
        v-if="editing"
        :plan="plan"
        :saving="mutations.busy.value"
        :stale="stale"
        @save="save"
        @cancel="stopEditing"
      />

      <template v-if="!editing || stale">
        <MarkdownBody v-if="plan.description" :source="plan.description" />
        <ol class="space-y-3" data-testid="test-plan-steps">
          <li
            v-for="step in plan.steps"
            :key="step.number"
            class="rounded-lg border border-default p-3"
            :data-testid="`test-plan-step-${step.number}`"
          >
            <p class="font-semibold">{{ step.number }}. {{ step.title }}</p>
            <div class="mt-2 grid gap-3 text-sm md:grid-cols-2">
              <div>
                <p class="text-xs font-medium uppercase text-muted">Actions</p>
                <MarkdownBody :source="step.actions" />
              </div>
              <div>
                <p class="text-xs font-medium uppercase text-muted">Expected</p>
                <MarkdownBody v-if="step.expected" :source="step.expected" />
                <p v-else class="text-muted">A setup step: nothing to check.</p>
              </div>
            </div>
          </li>
        </ol>
        <p v-if="plan.steps.length === 0" class="text-sm text-muted">No steps yet: edit the plan to add some.</p>
      </template>

      <section class="space-y-2">
        <h2 class="text-lg font-semibold">Runs</h2>
        <p v-if="plan.runs.length === 0" class="text-sm text-muted">Not run yet.</p>
        <div v-else class="rounded-lg border border-default" data-testid="test-plan-runs">
          <TestRunRow v-for="run in plan.runs" :key="run.id" :run="run" />
        </div>
      </section>

      <TestRunStart v-model:open="starting" :plan="plan.slug" />
    </div>
  </QueryState>
</template>
