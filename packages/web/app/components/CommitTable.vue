<!--
  The commits a pull request introduces, oldest first: the order they were
  made in, which is the order a reviewer reads them in.

  Each row is what `git log` says and nothing more — there is no commit page
  to link to, because the tracker is not a code browser. The subject is the
  whole of the message that is shown; a body worth reading is read in a clone.
-->
<script setup lang="ts">
import { shortSha } from "~/utils/entities";

defineProps<{
  commits: readonly { sha: string; subject: string; author: string; date: string }[];
  /** How many the range holds, which the list may fall short of. */
  total: number;
}>();
</script>

<template>
  <section class="space-y-3" data-testid="pr-commits">
    <p v-if="commits.length === 0" class="text-sm text-muted">
      No commits: this pull request has no revision recorded, or its revision adds nothing.
    </p>
    <div v-else class="overflow-x-auto rounded-md border border-default">
      <table class="w-full text-sm">
        <thead class="bg-elevated text-start text-xs uppercase tracking-wide text-muted">
          <tr>
            <th class="px-3 py-2 text-start font-semibold">Commit</th>
            <th class="px-3 py-2 text-start font-semibold">Author</th>
            <th class="px-3 py-2 text-start font-semibold">Date</th>
            <th class="px-3 py-2 text-end font-semibold">Hash</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="commit in commits"
            :key="commit.sha"
            class="border-t border-default"
            :data-testid="`commit-${commit.sha}`"
          >
            <td class="px-3 py-2 font-medium" :title="commit.subject">{{ commit.subject }}</td>
            <td class="whitespace-nowrap px-3 py-2"><PersonLabel :person="commit.author" /></td>
            <td class="whitespace-nowrap px-3 py-2 text-muted"><TimeAgo :iso="commit.date" /></td>
            <td class="px-3 py-2 text-end"><code :title="commit.sha">{{ shortSha(commit.sha) }}</code></td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="total > commits.length" class="text-xs text-muted">
      Showing the first {{ commits.length }} of {{ total }} commits.
    </p>
  </section>
</template>
