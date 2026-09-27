<!--
  The tracker commits of a pull request's revision, at the foot of its
  Changes tab: what each one did, said in a sentence.

  A branch carries tracker commits beside its code — the pull request's own
  file, the issue it closes, comments — and as a diff they read as renames and
  one-line frontmatter edits. The server says what each did (`Pr.activity`);
  this lays them out as a timeline, folded away until asked for, because the
  code above is what the tab is opened for. A commit's own files open under
  it with the same rendering as the diff above.

  Nothing is shown while they are read, nor when the revision holds none.
-->
<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import { PR_ACTIVITY_QUERY } from "~/graphql/queries";
import { activitySentence, factLabel, verbColor } from "~/utils/activity";
import { shortSha } from "~/utils/entities";

const props = defineProps<{
  /** The pull request whose page this is. */
  prRef: string;
  /**
   * Where the tracker commits after the pinned head are: the target once the
   * pull request is merged, its own branch before.
   */
  branch: string;
}>();

const LIMIT = 100;

const { result, error, refetch } = useQuery(
  PR_ACTIVITY_QUERY,
  () => ({ ref: props.prRef, limit: LIMIT }),
  { fetchPolicy: "cache-first" },
);
const activity = computed(() => result.value?.pr.activity ?? null);
const sentences = computed(
  () =>
    new Map((activity.value?.commits ?? []).map((c) => [c.sha, activitySentence(c, props.prRef)])),
);

const open = ref(false);
/** The commits whose files are shown, by SHA. */
const shown = reactive(new Set<string>());

function toggleFiles(sha: string): void {
  if (shown.has(sha)) shown.delete(sha);
  else shown.add(sha);
}

const route = useRoute();
/** The same address without `tab`, which is how the page says Conversation. */
const conversation = computed(() => {
  const { tab: _tab, ...rest } = route.query;
  return { query: rest };
});

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
</script>

<template>
  <section
    v-if="error || (activity !== null && activity.total > 0)"
    class="mt-8 border-t border-default pt-2"
    data-testid="tracker-activity"
  >
    <p v-if="error" class="flex items-center gap-2 text-sm text-muted">
      Could not read this revision's tracker commits.
      <UButton color="neutral" variant="ghost" size="xs" @click="refetch()">Retry</UButton>
    </p>

    <template v-else-if="activity">
      <UButton
        color="neutral"
        variant="ghost"
        class="-ms-2"
        :icon="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
        :aria-expanded="open"
        data-testid="toggle-tracker-activity"
        @click="open = !open"
      >
        <span class="font-semibold">Navbook activity</span>
        <span class="font-normal text-muted">
          {{ plural(activity.total, "commit") }} on the tracker, kept out of the diff above
        </span>
      </UButton>

      <ol v-if="open" class="ms-2 mt-2 border-s-2 border-default" data-testid="tracker-timeline">
        <li
          v-for="commit in activity.commits"
          :key="commit.sha"
          class="relative space-y-2 pb-6 ps-6"
          :data-testid="`tracker-commit-${commit.sha}`"
        >
          <span
            class="absolute -start-[7px] top-1.5 size-3 rounded-full border-2 border-default bg-default"
            aria-hidden="true"
          />
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <UBadge :color="verbColor(commit.verb)" variant="subtle" size="sm" class="min-w-16 justify-center">
              {{ commit.verb ?? "commit" }}
            </UBadge>
            <span v-if="sentences.get(commit.sha)" data-testid="tracker-sentence">
              {{ sentences.get(commit.sha)?.lead }}
              <NuxtLink
                v-if="sentences.get(commit.sha)?.record"
                :to="sentences.get(commit.sha)?.record?.to"
                class="font-mono text-primary hover:underline"
              >{{ sentences.get(commit.sha)?.record?.label }}</NuxtLink>{{ sentences.get(commit.sha)?.tail }}
              <strong v-if="sentences.get(commit.sha)?.emphasis">{{ sentences.get(commit.sha)?.emphasis }}</strong>
            </span>
            <span class="ms-auto text-xs text-muted">
              <code>{{ shortSha(commit.sha) }}</code> ·
              <PersonLabel :person="commit.author" /> ·
              <TimeAgo :iso="commit.date" />
            </span>
          </div>
          <p v-if="commit.title && commit.entity !== prRef" class="text-sm text-muted">{{ commit.title }}</p>
          <ul v-if="commit.facts.length > 0" class="flex flex-wrap gap-2 text-xs">
            <li
              v-for="fact in commit.facts.map(factLabel)"
              :key="fact.field + fact.value"
              class="rounded bg-elevated px-2 py-0.5"
            >
              <code>{{ fact.field }}</code>: {{ fact.value }}
            </li>
          </ul>
          <UButton
            v-if="commit.files.length > 0"
            color="primary"
            variant="link"
            size="xs"
            class="px-0"
            :aria-expanded="shown.has(commit.sha)"
            :data-testid="`tracker-files-${commit.sha}`"
            @click="toggleFiles(commit.sha)"
          >
            {{ shown.has(commit.sha) ? "Hide diff" : `Show diff (${plural(commit.files.length, "file")})` }}
          </UButton>
          <div v-if="shown.has(commit.sha)" class="space-y-2">
            <DiffFile
              v-for="(file, index) in commit.files"
              :key="file.path"
              :file="file"
              :index="index"
              :anchor="`tracker-${commit.sha}-${index}`"
            />
          </div>
        </li>
        <li class="ps-6 text-sm text-muted" data-testid="tracker-later">
          <template v-if="activity.total > activity.commits.length">
            The {{ activity.total - activity.commits.length }} after these are not listed.
          </template>
          Later tracker commits on this PR (reviews, revisions, the merge) are on
          <code>{{ branch }}</code>, not in this diff. They are on the
          <NuxtLink :to="conversation" class="text-primary hover:underline" data-testid="tracker-conversation-link">Conversation tab</NuxtLink>.
        </li>
      </ol>
    </template>
  </section>
</template>
