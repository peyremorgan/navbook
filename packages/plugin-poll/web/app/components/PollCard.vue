<!--
  A poll, in its issue's discussion: what it asks, the ballot of the person
  looking, what the ballots add up to, and — once it is closed — what it came
  to.

  The form starts from where the person stands: their last ballot, or what
  still fits of it when the questions changed under it (`myDraft`). Sending it
  casts a whole new ballot, which replaces the last; sending one that answers
  nothing withdraws it.

  The results are hidden until the person has a ballot that counts, unless the
  poll says otherwise or is closed (`doc/spec.md` §6.4) — and the card says
  they are hidden and offers to show them, because a convention against
  anchoring is not a secret: the votes are files anybody can read.
-->
<script setup lang="ts">
import type { PollCardFragment } from "../../src/generated/gql/graphql";
import {
  type BallotDraft,
  ballotFaults,
  bodyText,
  byQuestion,
  carryOver,
  describeAnswer,
  draftFrom,
  draftToInput,
  own,
  resultsShown,
  sameBallot,
} from "../utils/poll";

const props = defineProps<{ poll: PollCardFragment }>();
const emit = defineEmits<{ reload: [] }>();

const mutations = usePollMutations();
const draft = ref<BallotDraft>(byQuestion());
const note = ref("");
const asked = ref(false);
const stale = ref<string | null>(null);
const editing = ref(false);
const closing = ref(false);

/**
 * Where the form starts. On a new poll, or once the person has cast a ballot,
 * from where they stand (`myDraft`). When only the questions changed — an edit
 * somebody made while this form was half filled in — from what is in the form
 * now, carried onto the new questions where it still fits, so nothing the
 * person picked and has not sent is thrown away.
 */
// Three sources rather than one getter returning an array: a fresh array is
// never the last one, so a refetch that changed none of them would reset a
// form the person has not sent yet.
watch(
  [() => props.poll.id, () => props.poll.myBallot?.id, () => props.poll.fingerprint],
  (now, before) => {
    const onlyQuestions = now[0] === before[0] && now[1] === before[1] && now[2] !== before[2];
    if (onlyQuestions) {
      draft.value = carryOver(props.poll.questions, draft.value);
      return;
    }
    draft.value = draftFrom(props.poll.questions, props.poll.myDraft.answers);
    note.value = props.poll.myDraft.note;
  },
  { immediate: true },
);

/**
 * Open, as the server read it — and as its issue is now: closing or reopening
 * the issue closes or reopens a poll nobody closed by hand (`doc/spec.md`
 * §6.2), and the issue's status reaches the cache before this poll's does.
 * The poll is read again when it changes, for the outcome that came with it.
 */
const isOpen = computed(() => props.poll.closed === null && props.poll.issue.status === "OPEN");
watch(
  () => props.poll.issue.status,
  () => emit("reload"),
);
const faulty = computed(() => props.poll.problems.length > 0);
const shown = computed(() => resultsShown(props.poll, asked.value));
const faults = computed(() => ballotFaults(props.poll.questions, draft.value));
const answers = computed(() => draftToInput(props.poll.questions, draft.value));
const hasBallot = computed(
  () => props.poll.myState === "COUNTED" || props.poll.myState === "REVOKED",
);
const unchanged = computed(
  () =>
    props.poll.myState === "COUNTED" &&
    bodyText(note.value) === (props.poll.myBallot?.note ?? "") &&
    sameBallot(props.poll.questions, draft.value, props.poll.myBallot?.answers),
);
const canVote = computed(
  () => answers.value.length > 0 && Object.keys(faults.value).length === 0 && !unchanged.value,
);

/** The issue it is on is open: a closed one's polls are closed with it. */
const issueOpen = computed(() => props.poll.issue.status === "OPEN");

async function cast(withdraw: boolean): Promise<void> {
  stale.value = null;
  try {
    await mutations.votePoll(
      {
        poll: props.poll.id,
        fingerprint: props.poll.fingerprint,
        answers: withdraw ? [] : answers.value,
        note: withdraw ? null : note.value,
      },
      withdraw,
    );
  } catch (error) {
    stale.value = staleContent(error);
    emit("reload");
  }
}

async function reopen(): Promise<void> {
  stale.value = null;
  try {
    await mutations.reopenPoll({ poll: props.poll.id, baseSha: props.poll.baseSha });
  } catch (error) {
    stale.value = staleContent(error);
    emit("reload");
  }
}

const menu = computed(() => [
  [
    ...(isOpen.value && !faulty.value
      ? [{ label: "Edit", icon: "i-lucide-pencil", onSelect: () => (editing.value = true) }]
      : []),
    ...(props.poll.closed === null && !faulty.value
      ? [{ label: "Close the poll", icon: "i-lucide-lock", onSelect: () => (closing.value = true) }]
      : []),
    ...(props.poll.closed !== null && issueOpen.value
      ? [{ label: "Reopen", icon: "i-lucide-lock-open", onSelect: () => void reopen() }]
      : []),
  ],
]);

/** Each question beside what it came to, in words; null for an undecided one. */
const decided = computed(() =>
  props.poll.questions.map((entry) => {
    const answer = props.poll.outcome?.find((candidate) => candidate.question === entry.id);
    return { question: entry, words: answer ? describeAnswer(entry, answer) : null };
  }),
);

const EMPTY = { picks: [], other: "" };
</script>

<template>
  <UCard :data-testid="`poll-card-${props.poll.id}`" :ui="{ body: 'space-y-4' }">
    <template #header>
      <div class="flex flex-wrap items-center gap-2">
        <UIcon name="i-lucide-vote" class="size-4 text-primary" aria-hidden="true" />
        <h3 class="font-semibold" data-testid="poll-title">{{ props.poll.title }}</h3>
        <UBadge
          :color="isOpen ? 'success' : 'neutral'"
          variant="subtle"
          size="sm"
          data-testid="poll-status"
        >
          {{ isOpen ? "Open" : "Closed" }}
        </UBadge>
        <span class="text-xs text-muted">
          <PersonLabel :person="props.poll.author" /> asked <TimeAgo :iso="props.poll.created" />
          · {{ props.poll.voters }} {{ props.poll.voters === 1 ? "voter" : "voters" }}
        </span>
        <DueDate v-if="props.poll.deadline && isOpen" :deadline="props.poll.deadline" />
        <UDropdownMenu v-if="menu[0]?.length" :items="menu" class="ms-auto">
          <UButton
            icon="i-lucide-ellipsis"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="Poll actions"
            data-testid="poll-menu"
          />
        </UDropdownMenu>
      </div>
    </template>

    <MarkdownBody v-if="props.poll.preamble" :source="props.poll.preamble" />

    <UAlert
      v-if="faulty"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-x"
      title="This poll's file has faults"
      description="Nothing can be changed here until they are fixed by hand; `nav doctor` lists them."
      data-testid="poll-faulty"
    />
    <UAlert
      v-if="stale"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Changed since you opened it"
      :description="`${stale}. It is shown as it is now; your answers are kept where they still fit.`"
      data-testid="poll-stale"
    />
    <UAlert
      v-if="isOpen && props.poll.myState === 'REVOKED'"
      color="warning"
      variant="subtle"
      icon="i-lucide-rotate-ccw"
      title="The questions changed since you voted"
      description="Your vote no longer counts. Your answers are filled in where they still fit; vote again to be counted."
      data-testid="poll-revoked"
    />

    <!-- The ballot, while there is one to cast. -->
    <form v-if="isOpen" class="space-y-4" data-testid="poll-ballot" @submit.prevent="cast(false)">
      <PollQuestionField
        v-for="(entry, index) in props.poll.questions"
        :key="entry.id"
        :model-value="own(draft, entry.id) ?? EMPTY"
        @update:model-value="(value) => (draft[entry.id] = value)"
        :question="entry"
        :number="index + 1"
        :disabled="faulty || mutations.busy.value"
        :fault="own(faults, entry.id) ?? null"
      />
      <UFormField label="Why" description="Optional, in Markdown: a note the other voters read.">
        <UTextarea v-model="note" :rows="1" autoresize class="w-full" :disabled="faulty" data-testid="poll-note" />
      </UFormField>
      <div class="flex flex-wrap items-center gap-2">
        <UButton type="submit" :disabled="!canVote || faulty" :loading="mutations.busy.value" data-testid="poll-submit">
          {{ hasBallot ? "Change my vote" : "Vote" }}
        </UButton>
        <UButton
          v-if="hasBallot"
          color="neutral"
          variant="ghost"
          :disabled="faulty || mutations.busy.value"
          data-testid="poll-withdraw"
          @click="cast(true)"
        >
          Withdraw my vote
        </UButton>
        <span v-if="props.poll.myState === 'COUNTED'" class="text-sm text-muted" data-testid="poll-voted">
          You voted.
        </span>
      </div>
    </form>

    <!-- What it came to. -->
    <div v-if="props.poll.outcome" class="space-y-2 rounded-lg bg-elevated/50 p-3" data-testid="poll-decision">
      <p class="text-sm text-muted">
        <template v-if="props.poll.closedByIssue">Closed with its issue; by its votes it came to:</template>
        <template v-else>
          Closed by <PersonLabel :person="props.poll.closedBy ?? ''" /><template v-if="props.poll.closed">,
            <TimeAgo :iso="props.poll.closed" /></template>. Decided:
        </template>
      </p>
      <ul class="space-y-1">
        <li
          v-for="entry in decided"
          :key="entry.question.id"
          class="text-sm"
          :data-testid="`poll-decided-${entry.question.id}`"
        >
          <span class="text-muted">{{ entry.question.text }}</span>
          →
          <strong v-if="entry.words">{{ entry.words }}</strong>
          <span v-else class="text-muted">undecided</span>
        </li>
      </ul>
      <MarkdownBody v-if="props.poll.decisionNote" :source="props.poll.decisionNote" />
    </div>

    <!-- The tallies, or a word on why they are not shown. -->
    <div class="border-t border-default pt-3">
      <div class="mb-2 flex items-center justify-between gap-2">
        <h4 class="text-sm font-medium">Results</h4>
        <UButton
          v-if="isOpen && props.poll.results === 'HIDDEN' && props.poll.myState !== 'COUNTED'"
          size="xs"
          color="neutral"
          variant="ghost"
          :icon="asked ? 'i-lucide-eye-off' : 'i-lucide-eye'"
          data-testid="poll-results-toggle"
          @click="asked = !asked"
        >
          {{ asked ? "Hide results" : "Show results" }}
        </UButton>
      </div>
      <PollResults v-if="shown" :poll="props.poll" />
      <p v-else class="text-sm text-muted" data-testid="poll-results-hidden">
        Hidden until you vote, so the leader does not decide for you.
      </p>
    </div>

    <PollEditor v-model:open="editing" :poll="props.poll" @reload="emit('reload')" />
    <PollCloseDialog v-model:open="closing" :poll="props.poll" @reload="emit('reload')" />
  </UCard>
</template>
