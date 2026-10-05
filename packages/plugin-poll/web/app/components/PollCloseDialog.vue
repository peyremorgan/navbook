<!--
  Closing a poll: what each question came to, as the closer decides it.

  It starts from what the votes came to (`doc/spec.md` §6.3), which is usually
  the decision, and lets the closer say otherwise — closing is a person's call,
  not arithmetic. A tied question starts undecided and must be decided, or
  left undecided on purpose, before the poll closes: the tally cannot break a
  tie, and nothing here pretends to.
-->
<script setup lang="ts">
import type { PollCardFragment } from "../../src/generated/gql/graphql";
import { closeDefaults, type Decision, decisionsToInput } from "../utils/poll";

const open = defineModel<boolean>("open", { required: true });
const props = defineProps<{ poll: PollCardFragment }>();
const emit = defineEmits<{ closed: []; reload: [] }>();

const mutations = usePollMutations();
const decisions = ref<Record<string, Decision>>({});
/** The tied questions, until the closer has said something about each. */
const pending = ref<string[]>([]);
const note = ref("");
const stale = ref<string | null>(null);

watch(
  open,
  (value) => {
    if (!value) return;
    const start = closeDefaults(props.poll);
    decisions.value = start.decisions;
    pending.value = start.mustChoose;
    note.value = "";
    stale.value = null;
  },
  { immediate: true },
);

/** "Undecided", then every option, as one choice for a single-choice question. */
const UNDECIDED = "__undecided";

function choices(question: PollCardFragment["questions"][number]) {
  return [
    { value: UNDECIDED, label: "Undecided" },
    ...question.options.map((option) => ({ value: option.id, label: option.label })),
  ];
}

/**
 * The radio a single-choice question shows chosen: none while it is tied and
 * undecided by the closer, "Undecided" once they leave it so, and none when
 * the decision is an answer in other words.
 */
function chosen(id: string): string | undefined {
  if (pending.value.includes(id)) return undefined;
  const decision = decisions.value[id] ?? null;
  return decision === null ? UNDECIDED : decision.picks[0];
}

function decided(id: string): void {
  pending.value = pending.value.filter((entry) => entry !== id);
}

function pickOne(id: string, value: string): void {
  decisions.value[id] = value === UNDECIDED ? null : { picks: [value], other: "" };
  decided(id);
}

function pickSeveral(id: string, values: string[]): void {
  const other = decisions.value[id]?.other ?? "";
  decisions.value[id] =
    values.length === 0 && other.trim() === "" ? null : { picks: values, other };
  decided(id);
}

function writeIn(id: string, multi: boolean, text: string): void {
  const picks = multi ? (decisions.value[id]?.picks ?? []) : [];
  decisions.value[id] = picks.length === 0 && text.trim() === "" ? null : { picks, other: text };
  decided(id);
}

async function confirm(): Promise<void> {
  if (pending.value.length > 0) return;
  stale.value = null;
  try {
    const payload = await mutations.closePoll({
      poll: props.poll.id,
      baseSha: props.poll.baseSha,
      decisions: decisionsToInput(props.poll.questions, decisions.value),
      note: note.value.trim() === "" ? null : note.value,
    });
    if (!payload) return;
    open.value = false;
    emit("closed");
  } catch (error) {
    stale.value = staleContent(error);
    // What the poll says now, so closing again is done against it.
    emit("reload");
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="`Close “${props.poll.title}”`">
    <template #body>
      <form class="space-y-5" data-testid="poll-close-dialog" @submit.prevent="confirm">
        <UAlert
          v-if="stale"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Changed since you opened it"
          :description="`${stale}. Close this, and look again at what it says now.`"
          data-testid="poll-close-stale"
        />
        <p class="text-sm text-muted">
          What each question came to. It starts from the votes; the decision is yours.
        </p>
        <div
          v-for="question in props.poll.questions"
          :key="question.id"
          class="space-y-2"
          :data-testid="`poll-decide-${question.id}`"
        >
          <p class="font-medium">
            {{ question.text }}
            <UBadge v-if="pending.includes(question.id)" color="warning" variant="subtle" size="sm" class="ms-1">
              Tied: decide it
            </UBadge>
          </p>
          <URadioGroup
            v-if="!question.multi"
            :model-value="chosen(question.id)"
            :items="choices(question)"
            @update:model-value="(value: string) => pickOne(question.id, value)"
          />
          <UCheckboxGroup
            v-else
            :model-value="decisions[question.id]?.picks ?? []"
            :items="question.options.map((option) => ({ value: option.id, label: option.label }))"
            @update:model-value="(values: string[]) => pickSeveral(question.id, values)"
          />
          <UInput
            v-if="question.other"
            :model-value="decisions[question.id]?.other ?? ''"
            placeholder="Or decide on something else…"
            class="w-full"
            :data-testid="`poll-decide-other-${question.id}`"
            @update:model-value="(text: string) => writeIn(question.id, question.multi, text)"
          />
        </div>
        <UFormField label="Why" description="Optional, in Markdown: what settled it.">
          <UTextarea v-model="note" :rows="2" autoresize class="w-full" data-testid="poll-close-note" />
        </UFormField>
      </form>
    </template>
    <template #footer>
      <div class="flex flex-wrap items-center gap-2">
        <UButton
          :disabled="pending.length > 0"
          :loading="mutations.busy.value"
          data-testid="poll-close-confirm"
          @click="confirm"
        >
          Close the poll
        </UButton>
        <UButton color="neutral" variant="ghost" @click="open = false">Cancel</UButton>
        <span v-if="pending.length > 0" class="text-sm text-muted" data-testid="poll-close-pending">
          Decide the tied {{ pending.length === 1 ? "question" : "questions" }} first.
        </span>
      </div>
    </template>
  </UModal>
</template>
