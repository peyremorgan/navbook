<!--
  A pull request's changes: the summary, the list of files, and each file.

  The server sends every file and the patches of as many as fit its budget;
  the rest arrive one at a time, by path, when somebody asks (`DiffFile`
  emits `load`). What has been fetched is kept here for the life of the page,
  merged over the listing, so a file loaded once stays loaded when the tab is
  left and returned to.

  The file list at the top is what makes a diff of hundreds of files
  navigable: an anchor per file, and the counts beside each.
-->
<script setup lang="ts">
import { useApolloClient } from "@vue/apollo-composable";
import { PR_FILE_CHANGES_QUERY } from "~/graphql/queries";
import { countsLabel, estimatedHeight } from "~/utils/diff";
import type { ChangedFileFieldsFragment } from "~~/src/generated/gql/graphql";

const props = defineProps<{
  /** The pull request's reference, for the follow-up queries. */
  prRef: string;
  changes: {
    additions: number;
    deletions: number;
    files: readonly ChangedFileFieldsFragment[];
  };
}>();

const { client } = useApolloClient();

const loaded = reactive(new Map<string, ChangedFileFieldsFragment>());
const loading = reactive(new Set<string>());
const failed = ref<string | null>(null);

const files = computed(() => props.changes.files.map((file) => loaded.get(file.path) ?? file));

const withheld = computed(
  () => files.value.filter((file) => file.patch === null && file.lines > 0 && !file.binary).length,
);

async function load(path: string): Promise<void> {
  if (loading.has(path)) return;
  loading.add(path);
  failed.value = null;
  try {
    const { data } = await client.query({
      query: PR_FILE_CHANGES_QUERY,
      variables: { ref: props.prRef, paths: [path] },
      fetchPolicy: "network-only",
    });
    const file = data.pr.changes.files.find((item) => item.path === path);
    if (file) loaded.set(path, file);
  } catch {
    failed.value = path;
  } finally {
    loading.delete(path);
  }
}

const showList = ref(false);

/*
 * Progressive rendering, which is what puts the first file on screen fast.
 *
 * Everything above the fold is a handful of files; rendering all of them
 * before the browser may paint any is what made the forges' old diff pages
 * slow, and here it was measured at four seconds for a 2,800-file diff. So
 * the first few files are rendered with the summary, and the rest are handed
 * out a batch per idle period, each small enough to leave the page
 * responsive between them. Until its turn, a file is a placeholder: its path,
 * and the height it will take (`estimatedHeight`), so what the person sees
 * is a page filling in, not one moving under them.
 */
const FIRST_BATCH = 6;
const BATCH = 20;
/**
 * How many placeholders stand below the last rendered file. A diff of three
 * thousand files would otherwise put three thousand boxes in the DOM before
 * the first paint, and that alone was most of a second; beyond this many, a
 * line says how much is still to come.
 */
const LOOKAHEAD = 200;
const rendered = ref(FIRST_BATCH);
const shown = computed(() => files.value.slice(0, rendered.value + LOOKAHEAD));
const pending = computed(() => files.value.length - shown.value.length);

function renderMore(): void {
  if (rendered.value >= files.value.length) return;
  rendered.value = Math.min(files.value.length, rendered.value + BATCH);
  schedule(renderMore);
}

function schedule(work: () => void): void {
  if (typeof requestIdleCallback === "function") requestIdleCallback(work, { timeout: 100 });
  else setTimeout(work, 0);
}

onMounted(() => schedule(renderMore));
</script>

<template>
  <section class="space-y-3" data-testid="pr-changes">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span data-testid="changes-summary">
        <strong>{{ files.length }}</strong> file{{ files.length === 1 ? "" : "s" }} changed,
        <span class="font-mono text-success">+{{ changes.additions }}</span>
        <span class="font-mono text-error"> −{{ changes.deletions }}</span>
      </span>
      <span v-if="withheld > 0" class="text-muted">
        · {{ withheld }} large {{ withheld === 1 ? "file is" : "files are" }} not shown by default
      </span>
      <UButton
        v-if="files.length > 1"
        color="neutral"
        variant="ghost"
        size="xs"
        :icon="showList ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
        class="ms-auto"
        data-testid="toggle-file-list"
        @click="showList = !showList"
      >
        File list
      </UButton>
    </div>

    <ol v-if="showList" class="max-h-72 overflow-y-auto rounded-md border border-default p-2 text-xs" data-testid="file-list">
      <li v-for="(file, index) in files" :key="file.path" class="flex items-center gap-2 px-1 py-0.5">
        <a :href="`#file-${index}`" class="min-w-0 truncate font-mono hover:underline">{{ file.path }}</a>
        <span class="ms-auto whitespace-nowrap font-mono text-muted">{{ countsLabel(file.additions, file.deletions) }}</span>
      </li>
    </ol>

    <UAlert
      v-if="failed !== null"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="`Could not load the diff of ${failed}`"
    />

    <p v-if="files.length === 0" class="text-sm text-muted">
      No changes: this pull request has no revision recorded, or its revision changes nothing.
    </p>

    <div v-else class="space-y-3">
      <template v-for="(file, index) in shown" :key="file.path">
        <DiffFile
          v-if="index < rendered"
          :file="file"
          :index="index"
          :loading="loading.has(file.path)"
          @load="load"
        />
        <div
          v-else
          :id="`file-${index}`"
          class="diff-placeholder rounded-md border border-default"
          :style="{ containIntrinsicSize: `auto ${estimatedHeight(file)}px` }"
        >
          <div class="border-b border-default bg-elevated px-3 py-2 text-sm">
            <code class="ps-6">{{ file.path }}</code>
          </div>
        </div>
      </template>
      <p v-if="pending > 0" class="text-sm text-muted" data-testid="files-pending">
        … and {{ pending }} more file{{ pending === 1 ? "" : "s" }}, rendering.
      </p>
    </div>
  </section>
</template>

<style scoped>
/*
 * A placeholder is laid out only when it scrolls into view, like the file it
 * stands for: three thousand of them laid out at once was most of a second.
 */
.diff-placeholder {
  content-visibility: auto;
}
</style>
