<!--
  What this person has to do next.

  The listings answer "what is there"; this answers "what is mine", which is a
  different question and needs a different page. Three things make an entity
  somebody's: it is assigned to them, they opened the pull request, or it is
  waiting on their review. `EntityFilter` ANDs its keys, so those are three
  questions rather than one, asked in a single round trip and merged here —
  and which of them an entity came back in is what a row says about itself.

  Issues somebody merely filed are not here. Filing an issue is asking for
  work, not taking it on; an issue you opened and did not take is somebody
  else's inbox, and putting it in yours would fill the page with the very
  thing you delegated. A pull request is the other way round: opening one is
  offering finished work, and it is yours until it lands.

  Nothing is marked read. A review request leaves by being answered and an
  issue by being closed or reassigned, which the files already record — a read
  flag would be state about a person, and there is nowhere in a git repository
  to put that which is not everybody's business (spec 06 §6.6).

  Pull requests are asked for across every fetched branch without being asked
  to be, unlike the listing's toggle: a pull request lives on the branch it
  proposes to merge, so the ones that are yours are exactly the ones the
  serving checkout is least likely to hold, and an inbox that missed them
  would be missing the point rather than being fast.
-->
<script setup lang="ts">
import { type InboxSelection, narrowInbox, railCounts, sortInbox } from "~/utils/inbox";
import type { SortOrder } from "~/utils/sort";

const view = useInboxView();
const mutations = useIssueMutations();

const scope = computed(() => ({
  finished: view.params.value.finished,
  text: view.params.value.text,
}));
const inbox = useInbox(scope);

const selection = computed<InboxSelection>(() => ({
  view: view.params.value.view,
  kind: view.params.value.kind,
  feature: view.params.value.feature,
}));

const shown = computed(() =>
  sortInbox(narrowInbox(inbox.items.value, selection.value), view.params.value.sort),
);
const counts = computed(() => railCounts(inbox.items.value, selection.value));
const page = usePagedList(shown);

/*
 * Reordering, and only in the order that has somewhere to put a row.
 *
 * Under `newest` or `deadline` a drop would mean nothing: those read what the
 * files say rather than what somebody chose, and a row moved in one of them
 * would spring back on the next render. So the handles are only offered under
 * priority, which is the order a rank exists to produce.
 *
 * The rows handed over are the page's own slice, so the arithmetic only ever
 * sees neighbours that are actually on screen — dropping a row below the last
 * one visible places it after that one, not after fifty rows nobody has asked
 * to see.
 */
const reorder = useInboxReorder(
  page.shown,
  computed(() => view.params.value.sort === "priority"),
  async (id, rank) => (await mutations.updateIssue(id, { rank })) !== null,
);

const finished = computed({
  get: () => view.params.value.finished,
  set: (value: boolean) => view.patch({ finished: value }),
});

/**
 * Why there is nothing to show, which is three different things.
 *
 * The rail narrows what has already arrived, the search box narrows what is
 * asked for, and an inbox can simply be clear. Saying "nothing is assigned to
 * you" to somebody who has just searched for a word would be answering a
 * question they did not ask.
 */
const emptiness = computed<"nothing" | "searched" | "narrowed" | null>(() => {
  if (shown.value.length > 0) return null;
  if (inbox.items.value.length > 0) return "narrowed";
  return view.params.value.text === "" ? "nothing" : "searched";
});

const emptyTitle = computed(() => {
  switch (emptiness.value) {
    case "narrowed":
      return "Nothing matches this view";
    case "searched":
      return "Nothing matches those words";
    default:
      return "Nothing in your inbox";
  }
});

/** What is being left out, which a page showing nothing has to own up to. */
const unfinished = computed(() => (finished.value ? "" : " Finished work is not shown."));

const emptyDescription = computed(() => {
  if (emptiness.value === "narrowed") return "Widen the rail, or search for less.";
  if (emptiness.value === "searched") {
    return `No issue or pull request of yours has those words in its title, body or comments.${unfinished.value}`;
  }
  // The address is worth saying out loud exactly here. An inbox that is empty
  // because the tree spells somebody's name a second way looks identical to one
  // that is empty because there is nothing to do, and this is the only place
  // the difference can be noticed.
  const who = inbox.email.value;
  return who === null
    ? `Nothing is assigned to you, opened by you, or waiting on your review.${unfinished.value}`
    : `Nothing is assigned to ${who}, opened by them, or waiting on their review.${unfinished.value}`;
});
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <h1 class="text-xl font-semibold">Inbox</h1>
      <SortOrderChips
        :value="view.params.value.sort"
        @update="(sort: SortOrder) => view.patch({ sort })"
      />
      <USwitch
        v-model="finished"
        label="Finished work too"
        description="Closed issues, and closed or merged pull requests."
        data-testid="inbox-finished"
      />
    </div>

    <div class="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)]">
      <InboxRail :counts="counts" :selection="selection" @select="view.patch" />

      <div class="space-y-3">
        <SearchBox
          :text="view.params.value.text"
          testid="inbox-search"
          class="w-full"
          @commit="(text: string) => view.patch({ text })"
        />

        <QueryState
          :loading="inbox.loading.value && inbox.items.value.length === 0"
          :error="inbox.error.value"
          :empty="emptiness !== null"
          :empty-title="emptyTitle"
          :empty-description="emptyDescription"
          @retry="inbox.refetch()"
        >
          <div class="rounded-lg border border-default" data-testid="inbox-list">
            <InboxRow
              v-for="item in reorder.items.value"
              :key="`${item.kind}:${item.id}`"
              :item="item"
              :reorder="view.params.value.sort === 'priority' ? reorder.rowState(item) : undefined"
              @dragstart="(event: DragEvent) => reorder.onDragStart(item, event)"
              @dragover="(event: DragEvent) => reorder.onDragOver(item, event)"
              @dragleave="reorder.onDragLeave(item)"
              @drop="(event: DragEvent) => reorder.onDrop(item, event)"
              @dragend="reorder.onDragEnd()"
              @handlekey="(event: KeyboardEvent) => reorder.onHandleKey(item, event)"
            />
          </div>

          <!--
            What a reorder is doing, for a reader who is not watching the rows
            move. Polite rather than assertive: it is a running commentary on
            something the reader started, not an interruption.
          -->
          <p aria-live="polite" class="sr-only" data-testid="inbox-reorder-status">
            {{ reorder.announcement.value }}
          </p>
          <div class="mt-3 flex items-center justify-between text-sm text-muted">
            <span data-testid="inbox-count">
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
    </div>
  </div>
</template>
