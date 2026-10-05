<!--
  What the ballots that count add up to, question by question: a bar per
  option, who picked it, the answers in other words, and who leads.

  Votes are files anybody can read, so naming the voters hides nothing the
  repository does not already say; it is what makes a count worth trusting.
-->
<script setup lang="ts">
import type { PollCardFragment } from "../../src/generated/gql/graphql";
import { share } from "../utils/poll";

const props = defineProps<{ poll: PollCardFragment }>();

const rows = computed(() =>
  props.poll.questions.map((question) => {
    const tally = props.poll.tallies.find((entry) => entry.question === question.id);
    const answered = tally?.answered ?? 0;
    return {
      question,
      answered,
      tied: tally?.tied ?? false,
      leaders: tally?.leaders ?? [],
      options: question.options.map((option) => {
        const count = tally?.options.find((entry) => entry.option === option.id);
        return {
          option,
          count: count?.count ?? 0,
          voters: count?.voters ?? [],
          share: share(count?.count ?? 0, answered),
        };
      }),
      others: tally?.others ?? [],
    };
  }),
);
</script>

<template>
  <div class="space-y-4" data-testid="poll-results">
    <div v-for="row in rows" :key="row.question.id" class="space-y-2">
      <p class="text-sm font-medium">
        {{ row.question.text }}
        <span class="text-xs text-muted">
          · {{ row.answered }} {{ row.answered === 1 ? "answer" : "answers" }}
        </span>
        <UBadge v-if="row.tied" color="warning" variant="subtle" size="sm" class="ms-1" :data-testid="`poll-tied-${row.question.id}`">
          Tied
        </UBadge>
      </p>
      <div
        v-for="entry in row.options"
        :key="entry.option.id"
        class="space-y-1"
        :data-testid="`poll-tally-${row.question.id}-${entry.option.id}`"
      >
        <div class="flex items-center gap-2 text-sm">
          <UIcon
            v-if="row.leaders.includes(entry.option.id)"
            name="i-lucide-crown"
            class="size-3.5 text-warning"
            aria-label="Leading"
          />
          <span class="min-w-0 flex-1 truncate">{{ entry.option.label }}</span>
          <span class="tabular-nums text-muted" :data-testid="`poll-count-${row.question.id}-${entry.option.id}`">
            {{ entry.count }}
          </span>
        </div>
        <UProgress :model-value="entry.share" size="sm" />
        <p v-if="entry.voters.length" class="flex flex-wrap gap-x-2 text-xs text-muted">
          <PersonLabel v-for="voter in entry.voters" :key="voter" :person="voter" />
        </p>
      </div>
      <ul v-if="row.others.length" class="space-y-1 text-sm" :data-testid="`poll-others-${row.question.id}`">
        <li v-for="(other, index) in row.others" :key="index" class="flex flex-wrap gap-x-2">
          <span>“{{ other.text }}”</span>
          <PersonLabel :person="other.voter" class="text-xs text-muted" />
        </li>
      </ul>
    </div>
  </div>
</template>
