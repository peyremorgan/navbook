<!--
  One comment, or one review.

  A verdict is what makes a comment a review (§2.6), and the review fields —
  the revision it binds to, the file and line it points at — are shown because
  they are the whole point of recording a verdict against a revision: an
  approval belongs to one state of a branch, and a force-push must not inherit
  it.
-->
<script setup lang="ts">
import type { CommentNode } from "~/utils/comments";
import { shortSha } from "~/utils/entities";

const props = defineProps<{ node: CommentNode; depth?: number }>();
const emit = defineEmits<{ reply: [string] }>();

const comment = computed(() => props.node.comment);
const verdict = computed(() => {
  switch (comment.value.verdict) {
    case "APPROVE":
      return { label: "Approved", color: "success" as const, icon: "i-lucide-check-check" };
    case "REQUEST_CHANGES":
      return { label: "Changes requested", color: "warning" as const, icon: "i-lucide-file-pen" };
    default:
      return null;
  }
});
</script>

<template>
  <div :data-testid="`comment-${comment.id}`">
    <div class="rounded-lg border border-default">
      <div
        class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-default px-3 py-2 text-sm"
      >
        <PersonLabel :person="comment.author" avatar />
        <span class="text-muted">commented <TimeAgo :iso="comment.created" /></span>

        <UBadge
          v-if="verdict"
          :color="verdict.color"
          variant="subtle"
          size="sm"
          :icon="verdict.icon"
        >
          {{ verdict.label }}
        </UBadge>
        <UBadge
          v-if="comment.revision"
          color="neutral"
          variant="subtle"
          size="sm"
          :title="comment.revision"
        >
          {{ shortSha(comment.revision) }}
        </UBadge>
        <UBadge v-if="comment.file" color="neutral" variant="outline" size="sm">
          {{ comment.file }}<template v-if="comment.line">:{{ comment.line }}</template>
        </UBadge>

        <UBadge
          v-if="props.node.orphaned"
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-unlink"
          title="Its reply-to names a comment that is not in this thread."
          data-testid="orphaned-reply"
        >
          in reply to something not here
        </UBadge>

        <UButton
          class="ms-auto"
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-reply"
          :data-testid="`reply-to-${comment.id}`"
          @click="emit('reply', comment.id)"
        >
          Reply
        </UButton>
      </div>
      <div class="px-3 py-3">
        <MarkdownBody :source="comment.body" />
      </div>
    </div>

    <div v-if="props.node.replies.length" class="mt-2 space-y-2 border-s border-default ps-4">
      <CommentCard
        v-for="reply in props.node.replies"
        :key="reply.comment.id"
        :node="reply"
        :depth="(props.depth ?? 0) + 1"
        @reply="(id: string) => emit('reply', id)"
      />
    </div>
  </div>
</template>
