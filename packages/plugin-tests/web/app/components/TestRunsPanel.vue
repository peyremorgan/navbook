<!--
  A pull request's test runs, on its page.

  Registered as a panel. The host hands a panel the page's edit state, which
  carries no ID and no revisions, so this reads the route and asks for what it
  needs; `pr(ref)` is the host's own field, so it shares the page's cache.

  Runs against the latest revision come first, since that is what the tested
  state is read from; runs against earlier revisions say so. A pull request
  this server does not hold can be read here and not recorded on: its runs
  are written beside it, on its branch, as its comments are.
-->
<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import type { EntityEdit } from "~/utils/patch";
import { PR_TEST_RUNS_QUERY } from "../graphql/queries";

defineProps<{
  entity: EntityEdit;
  /** Declared and not read, so it is not passed through onto the root element. */
  saving: boolean;
  fieldSave?: unknown;
  /** True once the page has been told this pull request is on a branch not served. */
  isDisabled?: boolean;
}>();

const route = useRoute();
const ref_ = computed(() => String(route.params.ref ?? ""));
const { result } = useQuery(PR_TEST_RUNS_QUERY, () => ({ ref: ref_.value }), {
  fetchPolicy: "cache-and-network",
});
const pr = computed(() => result.value?.pr ?? null);
const head = computed(() => pr.value?.revisions.at(-1)?.head ?? null);
const current = computed(() =>
  (pr.value?.testRuns ?? []).filter((run) => run.commit === head.value),
);
const earlier = computed(() =>
  (pr.value?.testRuns ?? []).filter((run) => run.commit !== head.value),
);
const elsewhere = computed(() => (pr.value?.refs.length ?? 0) > 0);
const starting = ref(false);
</script>

<template>
  <section v-if="pr" class="space-y-2 border-t border-default pt-4" data-testid="test-runs-panel">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-sm font-medium">Test runs</h3>
      <TestStateBadge :state="pr.tested" data-testid="test-runs-tested" />
    </div>
    <p v-if="pr.testRuns.length === 0" class="text-sm text-muted">None yet.</p>
    <div v-if="current.length" class="rounded-lg border border-default">
      <TestRunRow v-for="run in current" :key="run.id" :run="run" show-plan />
    </div>
    <template v-if="earlier.length">
      <p class="text-xs text-muted">Against earlier revisions</p>
      <div class="rounded-lg border border-default opacity-75">
        <TestRunRow v-for="run in earlier" :key="run.id" :run="run" show-plan />
      </div>
    </template>
    <UButton
      size="sm"
      color="neutral"
      variant="subtle"
      icon="i-lucide-clipboard-check"
      :disabled="elsewhere || $props.isDisabled"
      :title="elsewhere ? `Its files live on ${pr.refs.join(', ')}, which this server does not serve` : undefined"
      data-testid="record-test-run"
      @click="starting = true"
    >
      Record a run
    </UButton>
    <TestRunStart v-model:open="starting" :pr="pr.id" />
  </section>
</template>
