<!--
  One feature: what it is, what describes it, and what has happened to it.

  The timeline is the point of the page. The API hands back issues, pull
  requests and commits as three lists, because the server has no business
  deciding how a reader wants them mixed; `mergeTimeline` mixes them, and the
  commits are what makes it a history rather than a listing — a fix that only
  touched code appears here through the trailer it already carries.
-->
<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import { staleContent } from "~/composables/useFeatureMutations";
import { FEATURE_QUERY } from "~/graphql/queries";
import { mergeTimeline } from "~/utils/timeline";

const route = useRoute();
const toast = useToast();
const mutations = useFeatureMutations();
const slug = computed(() => String(route.params.slug ?? ""));

const { result, loading, error, refetch } = useQuery(FEATURE_QUERY, () => ({ slug: slug.value }), {
  fetchPolicy: "cache-and-network",
});
const feature = computed(() => result.value?.feature ?? null);

const timeline = computed(() =>
  mergeTimeline({
    issues: feature.value?.issues ?? [],
    prs: feature.value?.prs ?? [],
    commits: feature.value?.commits ?? [],
  }),
);
const page = usePagedList(timeline);

/** Row lookups, so the timeline can render an entity it holds only by id. */
const issueById = computed(
  () => new Map((feature.value?.issues ?? []).map((issue) => [issue.id, issue])),
);
const prById = computed(() => new Map((feature.value?.prs ?? []).map((pr) => [pr.id, pr])));

/* --------------------------------------------------------------- editing */

async function saveCard(change: { title?: string; summary?: string | null }): Promise<void> {
  const current = feature.value;
  if (!current) return;
  try {
    await mutations.updateFeature({ slug: current.slug, ...change, baseSha: current.baseSha });
  } catch (failure) {
    const stale = staleContent(failure);
    if (stale === null) return;
    toast.add({ title: "Changed since you opened it", description: stale, color: "warning" });
    await refetch();
  }
}

const adding = ref(false);
const specTitle = ref("");
const specBody = ref("");

function openAdd(): void {
  specTitle.value = "";
  specBody.value = "";
  adding.value = true;
}

async function addSpec(): Promise<void> {
  if (specTitle.value.trim() === "" || specBody.value.trim() === "") return;
  const payload = await mutations.addSpec({
    feature: slug.value,
    title: specTitle.value.trim(),
    body: specBody.value.trim(),
  });
  if (!payload) return;
  adding.value = false;
  await navigateTo(`/features/${slug.value}/${payload.spec.fileName}`);
}
</script>

<template>
  <QueryState :loading="loading && feature === null" :error="error" @retry="refetch()">
    <article v-if="feature" class="space-y-6">
      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div class="space-y-6">
          <header class="space-y-2">
            <EditableText
              :value="feature.title"
              label="title"
              testid="title"
              required
              :saving="mutations.busy.value"
              @save="(title: string) => saveCard({ title })"
            >
              <h1 class="text-2xl font-semibold" data-testid="feature-title">{{ feature.title }}</h1>
            </EditableText>
            <code class="text-xs text-muted">{{ feature.slug }}</code>
          </header>

          <EditableText
            :value="feature.summary"
            label="summary"
            multiline
            testid="summary"
            :saving="mutations.busy.value"
            @save="(summary: string) => saveCard({ summary: summary.trim() === '' ? null : summary })"
          >
            <MarkdownBody :source="feature.summary" />
          </EditableText>

          <section class="space-y-2">
            <div class="flex items-center justify-between gap-2">
              <h2 class="font-semibold">Specification ({{ feature.specs.length }})</h2>
              <UButton
                size="xs"
                color="neutral"
                variant="subtle"
                icon="i-lucide-plus"
                data-testid="add-spec"
                @click="openAdd"
              >
                Add document
              </UButton>
            </div>
            <div v-if="feature.specs.length" class="rounded-lg border border-default" data-testid="spec-list">
              <NuxtLink
                v-for="spec in feature.specs"
                :key="spec.fileName"
                :to="`/features/${feature.slug}/${spec.fileName}`"
                class="flex flex-wrap items-center gap-2 border-b border-default px-3 py-2 last:border-0 hover:bg-elevated/50"
                :data-testid="`spec-row-${spec.fileName}`"
              >
                <UIcon name="i-lucide-file-text" class="size-4 text-muted" />
                <span class="font-medium">{{ spec.title }}</span>
                <code class="text-xs text-muted">{{ spec.fileName }}</code>
              </NuxtLink>
            </div>
            <p v-else class="text-sm text-muted">
              Nothing written down yet.
            </p>
          </section>
        </div>

        <aside class="space-y-5 lg:border-s lg:border-default lg:ps-6">
          <section class="space-y-1.5">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">Added</h3>
            <p class="text-sm">
              <TimeAgo :iso="feature.created" /> by <PersonLabel :person="feature.author" />
            </p>
          </section>
          <section class="space-y-2 border-t border-default pt-4">
            <UButton
              block
              color="neutral"
              variant="subtle"
              icon="i-lucide-plus"
              :to="`/issues/new?feature=${feature.slug}`"
              data-testid="file-issue"
            >
              File an issue
            </UButton>
            <UButton
              block
              color="neutral"
              variant="subtle"
              icon="i-lucide-list-filter"
              :to="`/issues?feature=${feature.slug}`"
              data-testid="filter-issues"
            >
              Issues in this feature
            </UButton>
            <p class="break-all text-xs text-muted">{{ feature.path }}</p>
          </section>
        </aside>
      </div>

      <section class="space-y-2">
        <h2 class="font-semibold">Timeline ({{ timeline.length }})</h2>
        <div v-if="timeline.length" class="rounded-lg border border-default" data-testid="timeline">
          <template v-for="event in page.shown.value" :key="event.key">
            <CommitRow v-if="event.kind === 'commit'" :commit="event.commit" />
            <IssueRow
              v-else-if="event.kind === 'issue' && issueById.get(event.entity.id)"
              :issue="issueById.get(event.entity.id)!"
            />
            <PrRow v-else-if="prById.get(event.entity.id)" :pr="prById.get(event.entity.id)!" />
          </template>
        </div>
        <p v-else class="text-sm text-muted">Nothing has touched this feature yet.</p>
        <div v-if="page.hasMore.value" class="flex items-center gap-3">
          <UButton size="xs" color="neutral" variant="subtle" @click="page.more()">Show more</UButton>
          <span class="text-xs text-muted">
            Showing {{ page.shown.value }} of {{ page.total.value }}
          </span>
        </div>
      </section>

      <UModal v-model:open="adding" title="Add a specification document">
        <template #body>
          <form class="space-y-4" data-testid="add-spec-form" @submit.prevent="addSpec">
            <UFormField label="Title" required>
              <UInput
                v-model="specTitle"
                placeholder="What this document is called"
                class="w-full"
                data-testid="new-spec-title"
              />
            </UFormField>
            <UFormField label="Body" required description="Markdown is rendered.">
              <UTextarea v-model="specBody" :rows="10" class="w-full" data-testid="new-spec-body" />
            </UFormField>
          </form>
        </template>
        <template #footer>
          <div class="flex gap-2">
            <UButton
              :disabled="specTitle.trim() === '' || specBody.trim() === ''"
              :loading="mutations.busy.value"
              data-testid="new-spec-submit"
              @click="addSpec"
            >
              Add document
            </UButton>
            <UButton color="neutral" variant="ghost" @click="adding = false">Cancel</UButton>
          </div>
        </template>
      </UModal>
    </article>
  </QueryState>
</template>
