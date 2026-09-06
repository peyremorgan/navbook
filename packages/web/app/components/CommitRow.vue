<!--
  One commit on a feature's timeline.

  Deliberately not a link: the server reports what a commit is, not where it
  can be read, and Navbook has no forge to send anybody to (spec 01 §1.1).
-->
<script setup lang="ts">
import { shortSha } from "~/utils/entities";

const props = defineProps<{
  commit: { sha: string; subject: string; author: string; date: string };
}>();
</script>

<template>
  <div
    class="flex flex-col gap-1 border-b border-default px-3 py-3 last:border-0"
    :data-testid="`commit-row-${props.commit.sha}`"
  >
    <div class="flex flex-wrap items-center gap-2">
      <UIcon name="i-lucide-git-commit-horizontal" class="size-4 text-muted" />
      <span>{{ props.commit.subject }}</span>
    </div>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      <code>{{ shortSha(props.commit.sha) }}</code>
      <span>
        committed <TimeAgo :iso="props.commit.date" /> by
        <PersonLabel :person="props.commit.author" />
      </span>
    </div>
  </div>
</template>
