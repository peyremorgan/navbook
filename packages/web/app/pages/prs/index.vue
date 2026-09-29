<!--
  Pull requests.

  A pull request's files live on the branch it proposes to merge (spec 03
  §3.5), so the checkout the server is on usually does not hold most of them.
  That is what the "every branch" toggle is for: without it this lists what is
  in the working tree, with it the server scans every branch it has fetched.
  The difference is worth a control rather than a default, because the scan
  costs a great deal more. A pull request found on another branch is written
  there all the same: the server makes a worktree on that branch for the write.

  The scan finds open pull requests only, so switching it on narrows by status
  without the filter having asked — the one place a listing here does that,
  which is why the switch says so in its own description.

  "Awaiting me" is the other switch, and it is one because it takes no value:
  it asks about whoever is signed in. A reviewer who has answered the latest
  revision drops out of it by itself, and a new revision puts everybody back
  (spec 02 §2.7).
-->
<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import { PRS_QUERY } from "~/graphql/queries";
import { distinctValues } from "~/utils/entities";
import { PR_STATUSES, toPrFilter } from "~/utils/filter-params";
import { pageTitle } from "~/utils/title";

useHead({ title: pageTitle("Pull requests") });

const route = useRoute();
const router = useRouter();
const filter = useEntityFilter({ statuses: PR_STATUSES, reviewers: true, noun: "pr" }, toPrFilter);

/** This address with the switch set as asked, and everything else in it kept. */
function withAllRefs(value: boolean) {
  const query = { ...route.query };
  if (value) query.refs = "all";
  else delete query.refs;
  return { query, hash: route.hash };
}

const allRefs = computed({
  get: () => route.query.refs === "all",
  set: (value: boolean) => void router.replace(withAllRefs(value)),
});

/**
 * Where the empty listing's suggestion goes: this same filter, with the switch
 * on. It is a link rather than a click handler so it reads as one, and it
 * replaces the address just as the switch does.
 *
 * The scan finds open pull requests only, so the suggestion is made only when
 * the filter lets an open one through; otherwise it would lead to a listing
 * that is empty by construction.
 */
const allRefsLink = computed(() => withAllRefs(true));
const allRefsCanHelp = computed(() => {
  const status = filter.filter.value.status;
  return status.length === 0 || status.includes("OPEN");
});

/**
 * The reviews this person owes, from the identity the token carries.
 *
 * `awaiting` is not part of the shared filter because it is not a value anybody
 * picks from a menu — it is one question with one answer, asked about whoever
 * is signed in, and a switch is what that is.
 */
const auth = useAuth();
const awaitingMe = computed({
  get: () => route.query.awaiting === "me" && auth.email.value !== null,
  set: (value: boolean) => {
    const query = { ...route.query };
    if (value) query.awaiting = "me";
    else delete query.awaiting;
    void router.replace({ query });
  },
});

const { result, loading, error, refetch } = useQuery(
  PRS_QUERY,
  () => ({
    filter: {
      ...filter.variables.value,
      ...(awaitingMe.value && auth.email.value !== null ? { awaiting: [auth.email.value] } : {}),
    },
    allRefs: allRefs.value,
  }),
  { fetchPolicy: "cache-and-network" },
);

const prs = computed(() => result.value?.prs ?? []);
const page = usePagedList(prs);

const people = usePeople();

const suggestions = computed(() => ({
  labels: distinctValues(prs.value, (pr) => pr.labels),
  milestones: distinctValues(prs.value, (pr) => (pr.milestone ? [pr.milestone] : [])),
  // People are read from the repository, so that menu is offered the registry
  // itself rather than whatever the listing on screen happens to mention.
  assignees: people.value,
  authors: people.value,
  reviewers: people.value,
}));
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <h1 class="text-xl font-semibold">Pull requests</h1>
      <div class="flex flex-wrap items-center gap-4">
        <USwitch
          v-if="auth.email.value"
          v-model="awaitingMe"
          label="Awaiting me"
          description="Asked for your review, and you have not answered the latest revision."
          data-testid="awaiting-me"
        />
        <USwitch
          v-model="allRefs"
          label="Every fetched branch"
          description="Slower; finds open pull requests this checkout does not hold."
          data-testid="all-refs"
        />
      </div>
    </div>

    <EntityFilterBar
      :filter="filter.filter.value"
      noun="pr"
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
      @retry="refetch()"
    >
      <template #empty-description>
        <template v-if="allRefs">Nothing on any fetched branch matches.</template>
        <template v-else-if="allRefsCanHelp">
          Nothing on this checkout matches. A pull request lives on its own branch —
          <NuxtLink :to="allRefsLink" replace class="text-primary hover:underline">try every fetched branch</NuxtLink>.
        </template>
        <template v-else>Nothing on this checkout matches.</template>
      </template>
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
