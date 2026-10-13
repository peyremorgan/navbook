<!--
  A poll, written or rewritten as fields: its title, its preamble, whether the
  results show before people vote, a deadline, and its questions.

  The client sends fields and the server composes `poll.md`, so nothing here
  can write a file the format would misread. What it checks before sending is
  what the server would refuse anyway, said beside the form.

  An edit that changes the questions — a word in a label included — revokes
  every ballot cast (`doc/spec.md` §5), so the editor says how many before it
  saves, and the save has to be asked for a second time.
-->
<script setup lang="ts">
import type { PollCardFragment } from "../../src/generated/gql/graphql";
import {
  bodyText,
  draftToQuestions,
  emptyOption,
  emptyQuestion,
  type QuestionDraft,
  questionsFault,
  questionsToDraft,
  wouldRevoke,
} from "../utils/poll";

const open = defineModel<boolean>("open", { required: true });
const props = defineProps<{
  /** The issue to ask in, for a new poll. */
  issue?: string;
  /** The poll to edit; absent for a new one. */
  poll?: PollCardFragment | null;
}>();
const emit = defineEmits<{ saved: [id: string]; reload: [] }>();

const mutations = usePollMutations();
const title = ref("");
const preamble = ref("");
const visible = ref(false);
const deadline = ref("");
const questions = ref<QuestionDraft[]>([]);
const problem = ref<string | null>(null);
const stale = ref<string | null>(null);
/** Set once the revocation has been shown; the next save goes ahead. */
const warned = ref(false);

watch(
  open,
  (value) => {
    if (!value) return;
    title.value = props.poll?.title ?? "";
    preamble.value = props.poll?.preamble ?? "";
    visible.value = props.poll?.results === "VISIBLE";
    deadline.value = props.poll?.deadline ?? "";
    questions.value = questionsToDraft(props.poll?.questions ?? []);
    problem.value = null;
    stale.value = null;
    warned.value = false;
  },
  { immediate: true },
);

const revoking = computed(
  () =>
    props.poll != null &&
    props.poll.voters > 0 &&
    wouldRevoke(props.poll.questions, questions.value),
);
watch(revoking, () => {
  warned.value = false;
});

/** Nothing to save: the server would refuse an edit that changes nothing. */
const unchanged = computed(
  () =>
    props.poll != null &&
    title.value.trim() === props.poll.title &&
    bodyText(preamble.value) === props.poll.preamble &&
    visible.value === (props.poll.results === "VISIBLE") &&
    deadline.value.trim() === (props.poll.deadline ?? "") &&
    !wouldRevoke(props.poll.questions, questions.value),
);

function move<T>(list: T[], index: number, by: -1 | 1): void {
  const target = index + by;
  if (target < 0 || target >= list.length) return;
  const [entry] = list.splice(index, 1);
  if (entry !== undefined) list.splice(target, 0, entry);
}

async function save(): Promise<void> {
  if (title.value.trim() === "") {
    problem.value = "A poll needs a title.";
    return;
  }
  problem.value = questionsFault(questions.value);
  if (problem.value !== null) return;
  if (revoking.value && !warned.value) {
    warned.value = true;
    return;
  }
  if (props.poll && unchanged.value) {
    open.value = false;
    return;
  }
  stale.value = null;
  const fields = {
    title: title.value.trim(),
    preamble: preamble.value,
    results: visible.value ? ("VISIBLE" as const) : ("HIDDEN" as const),
    deadline: deadline.value.trim() === "" ? null : deadline.value.trim(),
  };
  try {
    const payload = props.poll
      ? await mutations.editPoll({
          poll: props.poll.id,
          baseSha: props.poll.baseSha,
          ...fields,
          ...(wouldRevoke(props.poll.questions, questions.value)
            ? { questions: draftToQuestions(questions.value) }
            : {}),
        })
      : await mutations.openPoll({
          issue: props.issue ?? "",
          ...fields,
          questions: draftToQuestions(questions.value),
        });
    if (!payload) return;
    open.value = false;
    emit("saved", payload.poll.id);
  } catch (error) {
    stale.value = staleContent(error);
    // What the poll says now, so the next save is made against it.
    emit("reload");
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="props.poll ? 'Edit the poll' : 'Open a poll'"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <form class="space-y-4" data-testid="poll-editor" @submit.prevent="save">
        <UAlert
          v-if="stale"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Changed since you opened it"
          :description="`${stale}. Your draft is still here; the poll as it is now is on the page.`"
          data-testid="poll-editor-stale"
        />
        <UFormField label="Title" required>
          <UInput v-model="title" class="w-full" placeholder="What is being decided" data-testid="poll-editor-title" />
        </UFormField>
        <UFormField label="Preamble" description="What a voter needs to know first. Markdown; may be empty.">
          <UTextarea v-model="preamble" :rows="3" autoresize class="w-full" data-testid="poll-editor-preamble" />
        </UFormField>
        <div class="flex flex-wrap items-end gap-4">
          <USwitch
            v-model="visible"
            label="Show results before voting"
            description="Hidden until somebody votes, by default, so the leader does not decide for them."
            data-testid="poll-editor-visible"
          />
          <UFormField label="Wanted by" description="Optional; nothing closes it by itself.">
            <UInput v-model="deadline" type="date" data-testid="poll-editor-deadline" />
          </UFormField>
        </div>

        <ol class="space-y-3">
          <li
            v-for="(question, q) in questions"
            :key="question.key"
            class="space-y-2 rounded-lg border border-default p-3"
            :data-testid="`poll-editor-question-${q + 1}`"
          >
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-muted">{{ q + 1 }}.</span>
              <UInput
                v-model="question.text"
                class="flex-1"
                placeholder="The question"
                :data-testid="`poll-editor-question-${q + 1}-text`"
              />
              <UButton icon="i-lucide-arrow-up" color="neutral" variant="ghost" size="sm" :disabled="q === 0" aria-label="Move up" @click="move(questions, q, -1)" />
              <UButton icon="i-lucide-arrow-down" color="neutral" variant="ghost" size="sm" :disabled="q === questions.length - 1" aria-label="Move down" @click="move(questions, q, 1)" />
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="sm"
                aria-label="Remove question"
                :disabled="questions.length === 1"
                :data-testid="`poll-editor-question-${q + 1}-remove`"
                @click="questions.splice(q, 1)"
              />
            </div>
            <div class="flex flex-wrap gap-4 ps-5">
              <USwitch v-model="question.multi" label="Any number of answers" :data-testid="`poll-editor-question-${q + 1}-multi`" />
              <USwitch v-model="question.other" label="Accept answers in other words" :data-testid="`poll-editor-question-${q + 1}-other`" />
            </div>
            <ul class="space-y-2 ps-5">
              <li
                v-for="(option, o) in question.options"
                :key="option.key"
                class="space-y-1"
                :data-testid="`poll-editor-question-${q + 1}-option-${o + 1}`"
              >
                <div class="flex items-center gap-2">
                  <UInput v-model="option.label" class="flex-1" placeholder="An option" :data-testid="`poll-editor-question-${q + 1}-option-${o + 1}-label`" />
                  <UButton icon="i-lucide-arrow-up" color="neutral" variant="ghost" size="xs" :disabled="o === 0" aria-label="Move up" @click="move(question.options, o, -1)" />
                  <UButton icon="i-lucide-arrow-down" color="neutral" variant="ghost" size="xs" :disabled="o === question.options.length - 1" aria-label="Move down" @click="move(question.options, o, 1)" />
                  <UButton
                    icon="i-lucide-x"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    aria-label="Remove option"
                    :disabled="question.options.length === 1"
                    @click="question.options.splice(o, 1)"
                  />
                </div>
                <UTextarea
                  v-model="option.description"
                  :rows="1"
                  autoresize
                  class="w-full"
                  placeholder="More about it (optional, Markdown)"
                  :data-testid="`poll-editor-question-${q + 1}-option-${o + 1}-description`"
                />
              </li>
            </ul>
            <UButton
              size="xs"
              color="neutral"
              variant="subtle"
              icon="i-lucide-plus"
              class="ms-5"
              :data-testid="`poll-editor-question-${q + 1}-add-option`"
              @click="question.options.push(emptyOption())"
            >
              Add an option
            </UButton>
          </li>
        </ol>
        <UButton icon="i-lucide-plus" color="neutral" variant="subtle" data-testid="poll-editor-add-question" @click="questions.push(emptyQuestion())">
          Add a question
        </UButton>

        <UAlert
          v-if="revoking && warned"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="The questions changed"
          :description="`Saving revokes the ${props.poll?.voters === 1 ? 'vote' : `${props.poll?.voters} votes`} cast so far: whoever voted is asked again, starting from what they said. Save again to go ahead.`"
          data-testid="poll-editor-revokes"
        />
        <p v-if="problem" class="text-sm text-error" data-testid="poll-editor-problem">{{ problem }}</p>
      </form>
    </template>
    <template #footer>
      <div class="flex gap-2">
        <UButton :loading="mutations.busy.value" data-testid="poll-editor-save" @click="save">
          {{ props.poll ? (revoking && warned ? "Save and revoke the votes" : "Save") : "Open the poll" }}
        </UButton>
        <UButton color="neutral" variant="ghost" @click="open = false">Cancel</UButton>
      </div>
    </template>
  </UModal>
</template>
