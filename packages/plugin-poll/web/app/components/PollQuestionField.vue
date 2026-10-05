<!--
  One question of a ballot: its options, and a box for an answer in the
  voter's own words where the question takes one.

  A single-choice question is a radio group and a write-in replaces the pick,
  as the format has it (`doc/spec.md` §4.1): typing one clears the other.
  A multiple-choice question is a set of checkboxes, and a write-in sits
  beside them. An option's description is Markdown, rendered as the issue's
  body is.
-->
<script setup lang="ts">
import type { PollCardFragment } from "../../src/generated/gql/graphql";
import type { AnswerDraft } from "../utils/poll";

const props = defineProps<{
  question: PollCardFragment["questions"][number];
  /** Its number in the poll, from 1. */
  number: number;
  disabled?: boolean;
  /** What is wrong with the answer, said beside it. */
  fault?: string | null;
}>();

const answer = defineModel<AnswerDraft>({ required: true });

const items = computed(() =>
  props.question.options.map((option) => ({
    value: option.id,
    label: option.label,
    description: option.description ?? undefined,
  })),
);

/** The one pick of a single-choice question; choosing it drops a write-in. */
const single = computed({
  get: () => answer.value.picks[0],
  set: (value: string | undefined) => {
    answer.value = { picks: value === undefined ? [] : [value], other: "" };
  },
});

/** The picks of a multiple-choice question; a write-in stays beside them. */
const several = computed({
  get: () => answer.value.picks,
  set: (value: string[]) => {
    answer.value = { picks: [...value], other: answer.value.other };
  },
});

/** The write-in; on a single-choice question, typing it drops the pick. */
const other = computed({
  get: () => answer.value.other,
  set: (value: string) => {
    answer.value = {
      picks: props.question.multi || value.trim() === "" ? answer.value.picks : [],
      other: value,
    };
  },
});

const answered = computed(() => answer.value.picks.length > 0 || answer.value.other.trim() !== "");
</script>

<template>
  <fieldset class="space-y-2" :data-testid="`poll-question-${props.question.id}`">
    <legend class="mb-1 flex w-full items-baseline gap-2">
      <span class="font-medium">{{ props.number }}. {{ props.question.text }}</span>
      <span class="text-xs text-muted">
        {{ props.question.multi ? "Any number of answers" : "One answer" }}
      </span>
      <UButton
        v-if="answered && !props.disabled"
        size="xs"
        color="neutral"
        variant="link"
        class="ms-auto"
        :data-testid="`poll-clear-${props.question.id}`"
        @click="answer = { picks: [], other: '' }"
      >
        Skip
      </UButton>
    </legend>

    <URadioGroup
      v-if="!props.question.multi"
      v-model="single"
      :items="items"
      :disabled="props.disabled"
      :data-testid="`poll-options-${props.question.id}`"
    >
      <template #description="{ item }">
        <MarkdownBody v-if="item.description" :source="String(item.description)" class="text-sm text-muted" />
      </template>
    </URadioGroup>
    <UCheckboxGroup
      v-else
      v-model="several"
      :items="items"
      :disabled="props.disabled"
      :data-testid="`poll-options-${props.question.id}`"
    >
      <template #description="{ item }">
        <MarkdownBody v-if="item.description" :source="String(item.description)" class="text-sm text-muted" />
      </template>
    </UCheckboxGroup>

    <UInput
      v-if="props.question.other"
      v-model="other"
      :disabled="props.disabled"
      :placeholder="props.question.multi ? 'Something else too…' : 'Or something else…'"
      class="w-full"
      :data-testid="`poll-other-${props.question.id}`"
    />
    <p v-if="props.fault" class="text-sm text-error" :data-testid="`poll-fault-${props.question.id}`">
      {{ props.fault }}
    </p>
  </fieldset>
</template>
