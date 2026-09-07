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
import { type InboxSelection, narrowInbox, railCounts } from "~/utils/inbox";

const view = useInboxView();

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

const shown = computed(() => narrowInbox(inbox.items.value, selection.value));
const counts = computed(() => railCounts(inbox.items.value, selection.value));
const page = usePagedList(shown);

const finished = computed({
  get: () => view.params.value.finished,
  set: (value: boolean) => view.patch({ finished: value }),
});

/** Empty because there is nothing at all, or because the rail hid it. */
const emptiness = computed(() => {
  if (shown.value.length > 0) return null;
  return inbox.items.value.length === 0 ? "nothing" : "narrowed";
});

const emptyTitle = computed(() =>
  emptiness.value === "narrowed" ? "Nothing matches this view" : "Nothing in your inbox",
);

// The address is worth saying out loud exactly here. An inbox that is empty
// because the tree spells somebody's name a second way looks identical to one
// that is empty because there is nothing to do, and this is the only place the
// difference can be noticed.
const emptyDescription = computed(() => {
  if (emptiness.value === "narrowed") return "Widen the rail, or search for less.";
  const who = inbox.email.value ?? "you";
  return `Nothing is assigned to ${who}, opened by them, or waiting on their review.${
    finished.value ? "" : " Finished work is not shown."
  }`;
});
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <h1 class="text-xl font-semibold">Inbox</h1>
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
              v-for="item in page.shown.value"
              :key="`${item.kind}:${item.id}`"
              :item="item"
            />
          </div>
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
