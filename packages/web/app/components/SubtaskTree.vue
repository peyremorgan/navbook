<!--
  A decomposition tree, including the parts of it that are not issues.

  A link can name something the tree cannot show, and each case means a
  different thing: a pull request should never have been linked, a dangling id
  is an issue on a branch this checkout does not hold, a cycle is a chain that
  loops, and `repeated` is a subtree already drawn above. Collapsing them into
  "missing" would be a lie in three cases out of four, so each is drawn as what
  it is and only a real, expandable issue gets a link.
-->
<script setup lang="ts">
import { type LinkTreeNode, linkNote, linkState } from "~/utils/subtasks";

const props = defineProps<{ nodes: readonly LinkTreeNode[]; unlinkable?: boolean }>();
const emit = defineEmits<{ unlink: [string] }>();
</script>

<template>
  <ul class="space-y-1">
    <li v-for="node in props.nodes" :key="`${node.id}-${linkState(node)}`">
      <div class="flex flex-wrap items-center gap-2 py-1 text-sm">
        <template v-if="linkState(node) === 'issue' && node.issue">
          <StatusBadge :status="node.issue.status" />
          <NuxtLink :to="`/issues/${node.issue.id}`" class="hover:underline">
            {{ node.issue.title }}
          </NuxtLink>
          <code class="text-xs text-muted">#{{ node.id }}</code>
        </template>
        <template v-else>
          <code class="text-xs">#{{ node.id }}</code>
          <span v-if="node.issue" class="text-muted">{{ node.issue.title }}</span>
        </template>

        <UBadge
          v-if="linkNote(linkState(node))"
          color="neutral"
          variant="outline"
          size="sm"
          :data-testid="`link-${linkState(node)}`"
        >
          {{ linkNote(linkState(node)) }}
        </UBadge>

        <UButton
          v-if="props.unlinkable"
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-unlink"
          :aria-label="`Unlink #${node.id}`"
          :data-testid="`unlink-${node.id}`"
          @click="emit('unlink', node.id)"
        />
      </div>

      <div v-if="node.children?.length" class="border-s border-default ps-4">
        <SubtaskTree :nodes="node.children" @unlink="(id: string) => emit('unlink', id)" />
      </div>
    </li>
  </ul>
</template>
