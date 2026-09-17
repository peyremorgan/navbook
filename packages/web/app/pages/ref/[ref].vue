<!--
  Where a `#id` written in prose leads.

  An id names an issue or a pull request and says which of the two it is
  nowhere: both are minted from one space of 8 random characters (spec 02
  §2.2), so a link built out of a sentence cannot know whether it wants
  `/issues/:ref` or `/prs/:ref`. This route is the difference between those two
  facts. It asks the server — which is the side that knows what the tree holds
  — and sends the browser on with `replace`, so the page somebody was reading
  stays one Back away rather than two.

  Issues are asked about first, and usually that one question is the whole
  lookup: a reference to a pull request comes back `WRONG_KIND`, which is the
  server naming the kind rather than refusing to. Only a `NOT_FOUND` costs a
  second request, which is the pull request living on a branch this server has
  fetched but not checked out — findable, but not by a question about issues.

  Either way the entity is in Apollo's cache by the time the page it belongs to
  renders, so the redirect costs a render and not a round trip.

  A reference that matches nothing is not a fault. The target may live on a
  branch this server has not fetched, which is why `doctor` calls a dangling
  reference a warning and not an error (spec 02 §2.9) — so this says what
  happened and offers the listings, rather than showing a failure.
-->
<script setup lang="ts">
import { useApolloClient } from "@vue/apollo-composable";
import { ISSUE_QUERY, PR_QUERY } from "~/graphql/queries";
import { shortId } from "~/utils/entities";
import { type ApiFailure, describeApiError, errorHeading } from "~/utils/errors";
import { entityTitle } from "~/utils/title";

const route = useRoute();
const { client } = useApolloClient();

const reference = computed(() => String(route.params.ref ?? ""));

useHead({ title: computed(() => entityTitle(reference.value)) });

/** Null while the lookup is still running, and after it has redirected. */
const failure = ref<ApiFailure | null>(null);
/** True when neither kind knows the id: the reference is dangling. */
const dangling = ref(false);

/** Ask about one kind. `null` is the answer when the entity is there. */
async function found(
  query: typeof ISSUE_QUERY | typeof PR_QUERY,
  ref: string,
): Promise<ApiFailure | null> {
  try {
    await client.query({ query, variables: { ref }, fetchPolicy: "cache-first" });
    return null;
  } catch (error) {
    return describeApiError(error);
  }
}

async function resolve(): Promise<void> {
  const ref = reference.value;
  failure.value = null;
  dangling.value = false;

  const issue = await found(ISSUE_QUERY, ref);
  if (issue === null) {
    await navigateTo(`/issues/${ref}`, { replace: true });
    return;
  }
  // `WRONG_KIND` is the id resolving to something that is not an issue, and
  // there is only one other thing it could be. That is the usual answer for a
  // reference to a pull request, and it arrives without asking twice.
  if (issue.code === "WRONG_KIND") {
    await navigateTo(`/prs/${ref}`, { replace: true });
    return;
  }
  // Anything but `NOT_FOUND` — an ambiguous prefix, a prefix too short, a
  // server that cannot be reached — is an answer about the reference itself,
  // and asking the other kind would only produce the same one twice.
  if (issue.code !== "NOT_FOUND") {
    failure.value = issue;
    return;
  }

  // Nothing in the working tree carries the id. A pull request on a branch
  // this server has fetched but is not standing on is exactly that, and
  // `pr(ref:)` looks at the branches too.
  const pr = await found(PR_QUERY, ref);
  if (pr === null) {
    await navigateTo(`/prs/${ref}`, { replace: true });
    return;
  }
  if (pr.code !== "NOT_FOUND" && pr.code !== "WRONG_KIND") {
    failure.value = pr;
    return;
  }
  dangling.value = true;
}

// `ssr: false`, so this runs in the browser and nothing here needs to have
// happened before the shell is served. Watching the parameter rather than
// resolving once covers a second reference followed from the page this one
// lands on.
watch(reference, () => void resolve(), { immediate: true });
</script>

<template>
  <div class="mx-auto max-w-2xl" data-testid="reference">
    <UAlert
      v-if="failure"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="errorHeading(failure.code)"
      :actions="[
        { label: 'Try again', color: 'neutral', variant: 'subtle', onClick: () => resolve() },
      ]"
    >
      <template #description>
        <p>{{ failure.message }}</p>
        <ul v-if="failure.details.length" class="mt-1 list-disc ps-5">
          <li v-for="detail in failure.details" :key="detail">{{ detail }}</li>
        </ul>
      </template>
    </UAlert>

    <div
      v-else-if="dangling"
      class="rounded-lg border border-dashed border-default p-10 text-center"
      data-testid="reference-dangling"
    >
      <p class="font-medium">Nothing here answers to #{{ shortId(reference) }}</p>
      <p class="mt-1 text-sm text-muted">
        No issue or pull request this server has fetched carries that identifier. It may
        name a comment, which has no page of its own, or live on a branch this server does
        not have.
      </p>
      <div class="mt-4 flex justify-center gap-2">
        <UButton to="/issues" color="neutral" variant="subtle">Issues</UButton>
        <UButton to="/prs" color="neutral" variant="subtle">Pull requests</UButton>
      </div>
    </div>

    <div v-else class="space-y-2" data-testid="loading">
      <USkeleton class="h-14 w-full" />
    </div>
  </div>
</template>
