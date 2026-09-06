<!--
  One specification document.

  The document is fetched through its feature rather than on its own, so the
  cache holds one copy of each: the feature page and this one read the same
  normalised `Spec`, and a save made here shows up there without a refetch.
-->
<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import { staleContent } from "~/composables/useFeatureMutations";
import { FEATURE_QUERY } from "~/graphql/queries";

const route = useRoute();
const mutations = useFeatureMutations();
const slug = computed(() => String(route.params.slug ?? ""));
const fileName = computed(() => String(route.params.file ?? ""));

const { result, loading, error, refetch } = useQuery(FEATURE_QUERY, () => ({ slug: slug.value }), {
  fetchPolicy: "cache-and-network",
});
const feature = computed(() => result.value?.feature ?? null);
const spec = computed(
  () => feature.value?.specs.find((candidate) => candidate.fileName === fileName.value) ?? null,
);

const stale = ref<string | null>(null);

async function save(change: { title: string; body: string; baseSha: string }): Promise<void> {
  stale.value = null;
  try {
    await mutations.updateSpec({ feature: slug.value, fileName: fileName.value, ...change });
  } catch (failure) {
    const message = staleContent(failure);
    // Anything else has already been reported by the shared error toast.
    if (message === null) return;
    stale.value = message;
  }
}

async function reload(): Promise<void> {
  await refetch();
  stale.value = null;
}
</script>

<template>
  <QueryState :loading="loading && feature === null" :error="error" @retry="refetch()">
    <div v-if="feature" class="space-y-4">
      <nav class="flex flex-wrap items-center gap-2 text-sm text-muted">
        <NuxtLink to="/features" class="hover:text-default">Features</NuxtLink>
        <span>/</span>
        <NuxtLink :to="`/features/${feature.slug}`" class="hover:text-default" data-testid="back-to-feature">
          {{ feature.title }}
        </NuxtLink>
      </nav>

      <SpecEditor
        v-if="spec"
        :spec="spec"
        :saving="mutations.busy.value"
        :stale="stale"
        @save="save"
        @reload="reload"
      />
      <div v-else class="rounded-lg border border-dashed border-default px-4 py-8 text-center">
        <p class="font-medium">No such document</p>
        <p class="text-sm text-muted">
          <code>{{ fileName }}</code> is not one of this feature's documents.
        </p>
      </div>
    </div>
  </QueryState>
</template>
