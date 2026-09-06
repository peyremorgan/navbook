<!--
  Pull requests.

  A pull request's files live on the branch it proposes to merge (spec 03
  §3.5), so the checkout the server is on usually does not hold most of them.
  That is what the "every branch" toggle is for: without it this lists what is
  in the working tree, with it the server scans every branch it has fetched.
  The difference is worth a control rather than a default, because the scan
  costs a great deal more and the result is only readable — a pull request on a
  branch this server does not serve cannot be commented on.

  The scan finds open pull requests only, so switching it on narrows by status
  without the filter having asked — the one place a listing here does that,
  which is why the switch says so in its own description.
-->
<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import { FEATURES_QUERY, PRS_QUERY } from "~/graphql/queries";
import { distinctValues } from "~/utils/entities";
import { PR_STATUSES } from "~/utils/filter-params";

const route = useRoute();
const router = useRouter();
const filter = useEntityFilter(PR_STATUSES);

const allRefs = computed({
  get: () => route.query.refs === "all",
  set: (value: boolean) => {
    const query = { ...route.query };
    if (value) query.refs = "all";
    else delete query.refs;
    void router.replace({ query });
  },
});

const { result, loading, error, refetch } = useQuery(
  PRS_QUERY,
  () => ({ filter: filter.variables.value, allRefs: allRefs.value }),
  { fetchPolicy: "cache-and-network" },
);

const prs = computed(() => result.value?.prs ?? []);
const page = usePagedList(prs);

// The feature registry, for the filter bar's menu. Cached: it changes far
// less often than a listing does, and every page that shows it wants the same
// answer.
const { result: featureList } = useQuery(FEATURES_QUERY, undefined, {
  fetchPolicy: "cache-first",
});

const suggestions = computed(() => ({
  labels: distinctValues(prs.value, (pr) => pr.labels),
  assignees: distinctValues(prs.value, (pr) => pr.assignees),
  authors: distinctValues(prs.value, (pr) => [pr.author]),
  milestones: distinctValues(prs.value, (pr) => (pr.milestone ? [pr.milestone] : [])),
  // Features are real directories, so the registry is the registry rather than
  // whatever the listing on screen happens to mention.
  features: (featureList.value?.features ?? []).map((feature) => feature.slug),
}));
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <h1 class="text-xl font-semibold">Pull requests</h1>
      <USwitch
        v-model="allRefs"
        label="Every fetched branch"
        description="Slower; finds open pull requests this checkout does not hold."
        data-testid="all-refs"
      />
    </div>

    <EntityFilterBar
      :filter="filter.filter.value"
      :statuses="PR_STATUSES"
      :empty="filter.empty.value"
      v-bind="suggestions"
      @patch="filter.patch"
      @clear="filter.clear"
    />

    <QueryState
      :loading="loading && prs.length === 0"
      :error="error"
      :empty="prs.length === 0"
      empty-title="No pull requests match this filter"
      :empty-description="
        allRefs
          ? 'Nothing on any fetched branch matches.'
          : 'Nothing on this checkout matches. A pull request lives on its own branch — try every fetched branch.'
      "
      @retry="refetch()"
    >
      <div class="rounded-lg border border-default" data-testid="pr-list">
        <PrRow v-for="pr in page.shown.value" :key="pr.id" :pr="pr" />
      </div>
      <div class="mt-3 flex items-center justify-between text-sm text-muted">
        <span data-testid="pr-count">Showing {{ page.shown.value.length }} of {{ page.total.value }}</span>
        <UButton
          v-if="page.hasMore.value"
          size="sm"
          color="neutral"
          variant="subtle"
          @click="page.more()"
        >
          Show more
        </UButton>
      </div>
    </QueryState>
  </div>
</template>
