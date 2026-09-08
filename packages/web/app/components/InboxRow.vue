<!--
  One thing to do, as a row.

  A line rather than the two the listings use. An inbox is read down the left
  edge — what it is, then what it is called — and most of what a listing spends
  its second line on is beside the point here: which branch it rides on, and a
  milestone nobody scanning a to-do list is asking about. What earns the space
  instead is why the row is here at all, which no listing ever has to say.

  The status is the icon's colour rather than a badge, because the same three
  colours are doing the work of a badge in a quarter of the width, and an
  inbox that showed "Open" on almost every row would be spending its width on
  the least surprising fact about it. The colour is looked up in a table:
  Tailwind reads the classes it emits out of the source, so a class assembled
  at runtime is one it has never heard of.

  The row is a link, so the feature chips are a sibling of it rather than part
  of it — a link inside a link is invalid, and browsers disagree about what to
  do with one. Same shape, and same reason, as `IssueRow`.

  The grip is outside the link for a related reason: the link must not become
  the drag source, or every attempt to reorder would race with following it.
  It is a button as well as a drag handle, so the same move is available from
  the keyboard — a listing only a pointer can reorder is one half the people
  using it cannot reorder at all.
-->
<script setup lang="ts">
import type { ReorderRow } from "~/composables/useInboxReorder";
import { statusColor, statusLabel } from "~/utils/entities";
import type { InboxItem, InboxReason } from "~/utils/inbox";
import { displayPerson } from "~/utils/people";

const props = defineProps<{
  item: InboxItem;
  /** Absent unless the listing is in an order a row can be placed in. */
  reorder?: ReorderRow;
}>();

const emit = defineEmits<{
  dragstart: [DragEvent];
  dragover: [DragEvent];
  dragleave: [];
  drop: [DragEvent];
  dragend: [];
  handlekey: [KeyboardEvent];
}>();

/** What each reason says on the row, in the words the rail uses for it. */
const REASONS: Record<InboxReason, { label: string; icon: string }> = {
  assigned: { label: "Assigned", icon: "i-lucide-user" },
  author: { label: "Author", icon: "i-lucide-pen-line" },
  awaiting: { label: "Review requested", icon: "i-lucide-eye" },
};

/** Written out, because a class built from a value is one Tailwind never sees. */
const STATUS_CLASS = {
  success: "text-success",
  primary: "text-primary",
  neutral: "text-muted",
} as const;

const entity = computed(() => props.item.entity);

/** A draft is open and not asking for anything yet, so it is drawn as neither. */
const draft = computed(
  () => props.item.kind === "pr" && props.item.entity.draft && entity.value.status === "OPEN",
);

const icon = computed(() =>
  props.item.kind === "issue" ? "i-lucide-circle-dot" : "i-lucide-git-pull-request",
);

const tone = computed(() =>
  draft.value ? STATUS_CLASS.neutral : STATUS_CLASS[statusColor(entity.value.status)],
);

const href = computed(() =>
  props.item.kind === "issue" ? `/issues/${props.item.id}` : `/prs/${props.item.id}`,
);

/**
 * What the icon says, for a reader who is not being shown a colour.
 *
 * The colour is the whole of the status here, so without this the difference
 * between an open row and a closed one would reach nobody using a screen
 * reader — and telling them apart is the entire point of the switch that puts
 * finished work on the page.
 */
const described = computed(() => {
  const noun = props.item.kind === "issue" ? "issue" : "pull request";
  const state = draft.value ? "Draft" : statusLabel(props.item.entity.status);
  return `${state} ${noun}`;
});
</script>

<template>
  <div
    class="flex items-start gap-1 border-b border-default px-3 py-2.5 last:border-0 hover:bg-elevated/50"
    :class="[
      props.reorder?.lifted ? 'opacity-40' : '',
      props.reorder?.edge === 'before' ? 'border-t-2 border-t-primary' : '',
      props.reorder?.edge === 'after' ? 'border-b-2 border-b-primary' : '',
    ]"
    :data-testid="`inbox-row-${props.item.id}`"
    @dragover="emit('dragover', $event)"
    @dragleave="emit('dragleave')"
    @drop="emit('drop', $event)"
  >
    <UButton
      v-if="props.reorder"
      size="xs"
      color="neutral"
      variant="ghost"
      icon="i-lucide-grip-vertical"
      class="shrink-0 cursor-grab"
      :draggable="props.reorder.draggable"
      :disabled="!props.reorder.draggable"
      :aria-pressed="props.reorder.lifted"
      :aria-label="`Reorder ${entity.title}`"
      :data-testid="`inbox-grip-${props.item.id}`"
      @dragstart="emit('dragstart', $event)"
      @dragend="emit('dragend')"
      @keydown="emit('handlekey', $event)"
    />

    <div class="min-w-0 flex-1">
    <NuxtLink :to="href" class="flex items-center gap-2.5">
      <UIcon :name="icon" class="size-4 shrink-0" :class="tone" aria-hidden="true" />
      <span class="sr-only">{{ described }}</span>
      <code class="shrink-0 text-xs text-muted">#{{ props.item.id }}</code>
      <span class="min-w-0 flex-1 truncate font-medium">{{ entity.title }}</span>

      <UBadge v-if="draft" color="neutral" variant="subtle" size="sm" class="hidden shrink-0 sm:inline-flex">
        Draft
      </UBadge>
      <UBadge
        v-for="label in entity.labels"
        :key="label"
        color="primary"
        variant="soft"
        size="sm"
        class="hidden shrink-0 lg:inline-flex"
      >
        {{ label }}
      </UBadge>

      <span class="ms-auto flex shrink-0 items-center gap-2">
        <UBadge
          v-for="reason in props.item.reasons"
          :key="reason"
          color="neutral"
          variant="subtle"
          size="sm"
          :icon="REASONS[reason].icon"
          :data-testid="`inbox-reason-${reason}`"
        >
          <!-- Narrow, the badge is its icon; the word is still read out. -->
          <span class="sr-only sm:not-sr-only">{{ REASONS[reason].label }}</span>
        </UBadge>
        <UAvatar
          :alt="displayPerson(entity.author).label"
          :title="entity.author"
          size="3xs"
          class="hidden sm:inline-flex"
        />
        <DueDate
          v-if="props.item.kind === 'issue' && props.item.entity.deadline"
          :deadline="props.item.entity.deadline"
          class="hidden shrink-0 sm:inline-flex"
        />
        <TimeAgo :iso="entity.created" class="hidden text-xs text-muted sm:inline" />
      </span>
    </NuxtLink>

    <div v-if="entity.features.length" class="mt-1 flex flex-wrap gap-1 ps-6">
      <NuxtLink
        v-for="feature in entity.features"
        :key="feature"
        :to="`/features/${feature}`"
        :data-testid="`inbox-row-feature-${feature}`"
      >
        <UBadge color="neutral" variant="subtle" size="sm" class="hover:bg-elevated">
          <UIcon name="i-lucide-layers" class="me-1 size-3" />{{ feature }}
        </UBadge>
      </NuxtLink>
    </div>
    </div>
  </div>
</template>
