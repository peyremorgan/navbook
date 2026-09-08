<!--
  Every issue that matches the filter.

  The whole matching set arrives in one answer — the API has no pagination and
  no sort argument — so both what is on screen and the order it is in are
  decided here, and the suggestions in the filter bar are drawn from the same
  answer for want of anywhere else to get them.

  Newest first unless somebody asks otherwise. The listing answers "what is
  there", where the order the work arrived in is the honest reading; the inbox
  answers "what next", and defaults to priority for that reason.
-->
<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import { FEATURES_QUERY, ISSUES_QUERY } from "~/graphql/queries";
import { distinctValues } from "~/utils/entities";
import { DEADLINE_STATES, ISSUE_STATUSES } from "~/utils/filter-params";
import { isSortOrder, type SortOrder, sortRows } from "~/utils/sort";

const route = useRoute();
const router = useRouter();
const filter = useEntityFilter({ statuses: ISSUE_STATUSES, deadlines: DEADLINE_STATES });

/*
 * The order, in the query string beside the filter.
 *
 * Owned by this page rather than by `useEntityFilter`, exactly as `refs` is on
 * the pull request listing — and deliberately so, because that is what makes
 * an order survive Clear. Clearing a filter is about which rows are listed and
 * not about the order they are read in.
 */
const sort = computed<SortOrder>(() =>
  isSortOrder(route.query.sort) ? route.query.sort : "newest",
);

function setSort(next: SortOrder): void {
  const query = { ...route.query };
  if (next === "newest") delete query.sort;
  else query.sort = next;
  void router.replace({ query });
}

const { result, loading, error, refetch } = useQuery(
  ISSUES_QUERY,
  () => ({ filter: filter.variables.value }),
  { fetchPolicy: "cache-and-network" },
);

const issues = computed(() => sortRows(result.value?.issues ?? [], sort.value));
const page = usePagedList(issues);

// The feature registry, for the filter bar's menu. Cached: it changes far
// less often than a listing does, and every page that shows it wants the same
// answer.
const { result: featureList } = useQuery(FEATURES_QUERY, undefined, {
  fetchPolicy: "cache-first",
});

const suggestions = computed(() => ({
  labels: distinctValues(issues.value, (issue) => issue.labels),
  assignees: distinctValues(issues.value, (issue) => issue.assignees),
  authors: distinctValues(issues.value, (issue) => [issue.author]),
  milestones: distinctValues(issues.value, (issue) => (issue.milestone ? [issue.milestone] : [])),
  // Features are real directories, so the registry is the registry rather than
  // whatever the listing on screen happens to mention.
  features: (featureList.value?.features ?? []).map((feature) => feature.slug),
}));
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <h1 class="text-xl font-semibold">Issues</h1>
      <div class="flex items-center gap-2">
        <SortOrderChips :value="sort" @update="setSort" />
        <UButton to="/issues/new" icon="i-lucide-plus" data-testid="new-issue">New issue</UButton>
      </div>
    </div>

    <EntityFilterBar
      :filter="filter.filter.value"
      :statuses="ISSUE_STATUSES"
      :deadlines="DEADLINE_STATES"
      :empty="filter.empty.value"
      v-bind="suggestions"
      @patch="filter.patch"
      @clear="filter.clear"
    />

    <QueryState
      :loading="loading && issues.length === 0"
      :error="error"
      :empty="issues.length === 0"
      empty-title="No issues match this filter"
      empty-description="Nothing in the tree matches. Widen the filter, or file one."
      @retry="refetch()"
    >
      <div class="rounded-lg border border-default" data-testid="issue-list">
        <IssueRow v-for="issue in page.shown.value" :key="issue.id" :issue="issue" />
      </div>
      <div class="mt-3 flex items-center justify-between text-sm text-muted">
        <span data-testid="issue-count">
          Showing {{ page.shown.value.length }} of {{ page.total.value }}
        </span>
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
