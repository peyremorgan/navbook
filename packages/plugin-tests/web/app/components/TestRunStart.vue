<!--
  Starting a run: which plan, against what.

  Opened from a plan's page (the plan is known) or from a pull request's (the
  plan is chosen, and the run is attached to the pull request, against its
  latest revision unless a commit is named). The run starts empty; the runner
  page is where its steps are recorded.
-->
<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import type { SaidFailure } from "~/utils/errors";
import { otherRefusal, refusedBranch } from "../composables/useTestMutations";
import { TEST_PLANS_QUERY } from "../graphql/queries";

const open = defineModel<boolean>("open", { required: true });

const props = defineProps<{
  /** The plan to run; absent, the dialog offers every plan. */
  plan?: string;
  /** The pull request to attach it to. */
  pr?: string;
}>();

const mutations = useTestMutations();
const { result } = useQuery(TEST_PLANS_QUERY, undefined, () => ({
  enabled: open.value && props.plan === undefined,
  fetchPolicy: "cache-first",
}));
const plans = computed(() =>
  (result.value?.testPlans ?? []).map((plan) => ({ label: plan.title, value: plan.slug })),
);

const chosen = ref<string | undefined>(props.plan);
const commit = ref("");
const version = ref("");
const environment = ref("");
const refused = ref<string | null>(null);
const other = ref<SaidFailure | null>(null);

watch(open, (value) => {
  if (!value) return;
  chosen.value = props.plan;
  commit.value = "";
  version.value = "";
  environment.value = "";
  refused.value = null;
  other.value = null;
});

async function start(): Promise<void> {
  if (!chosen.value) return;
  refused.value = null;
  other.value = null;
  try {
    const payload = await mutations.startRun({
      plan: chosen.value,
      pr: props.pr ?? null,
      commit: commit.value.trim() || null,
      version: version.value.trim() || null,
      environment: environment.value.trim() || null,
    });
    if (!payload) return;
    open.value = false;
    await navigateTo(`/tests/runs/${payload.run.id}`);
  } catch (error) {
    refused.value = refusedBranch(error);
    other.value = otherRefusal(error);
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="props.pr ? `Record a run on #${props.pr}` : 'Run this plan'">
    <template #body>
      <form class="space-y-4" data-testid="test-run-start" @submit.prevent="start">
        <UAlert
          v-if="refused"
          color="warning"
          variant="subtle"
          icon="i-lucide-git-branch"
          title="Not from this server"
          :description="`The pull request lives on ${refused}, which this server does not have checked out.`"
          data-testid="test-run-start-unserved"
        />
        <UAlert
          v-if="other"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-x"
          :title="other.heading"
          :description="other.message"
          data-testid="test-run-start-refused"
        />
        <UFormField v-if="props.plan === undefined" label="Plan" required>
          <USelect
            v-model="chosen"
            :items="plans"
            placeholder="Choose a plan"
            class="w-full"
            data-testid="test-run-start-plan"
          />
        </UFormField>
        <UFormField
          label="Commit"
          :description="
            props.pr
              ? 'Optional: the pull request\'s latest revision when empty.'
              : 'Optional: the served branch\'s head when empty, unless a version is named.'
          "
        >
          <UInput v-model="commit" class="w-full" placeholder="a hash, a branch or a tag" data-testid="test-run-start-commit" />
        </UFormField>
        <UFormField label="Version" description="Optional: a release or a build, by name.">
          <UInput v-model="version" class="w-full" data-testid="test-run-start-version" />
        </UFormField>
        <UFormField label="Environment" description="Optional: where it is being tested.">
          <UInput v-model="environment" class="w-full" data-testid="test-run-start-environment" />
        </UFormField>
      </form>
    </template>
    <template #footer>
      <div class="flex gap-2">
        <UButton :disabled="!chosen" :loading="mutations.busy.value" data-testid="test-run-start-submit" @click="start">
          Start the run
        </UButton>
        <UButton color="neutral" variant="ghost" @click="open = false">Cancel</UButton>
      </div>
    </template>
  </UModal>
</template>
