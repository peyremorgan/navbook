<!--
  An edit the server refused because somebody changed that field first.

  The field editors close on save, so by the time the refusal arrives the words
  are no longer in an input; this is where they are kept. What was typed is the
  only copy of itself, and a page that discarded it to show an error would be
  doing the losing the refusal exists to prevent. The page behind this alert
  has been fetched again, so it shows what the file says now.

  Then the decision is the person's, which is the point of surfacing a conflict
  rather than resolving it (spec 06 §6.3): save theirs over what is there,
  having seen it, or leave it. Nothing here picks one.
-->
<script setup lang="ts">
import { describeEntityEdit, type EntityEdit, fieldLabel } from "~/utils/patch";

const props = defineProps<{
  /** The fields the server said had moved, as the mutation names them. */
  moved: string[];
  /** The edit that was refused, as it was sent. */
  change: Partial<EntityEdit>;
  saving?: boolean;
}>();

const emit = defineEmits<{ reapply: []; dismiss: [] }>();

const fields = computed(() => {
  const names = props.moved.map(fieldLabel);
  if (names.length === 0) return "this";
  if (names.length === 1) return `the ${names[0]}`;
  return `the ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
});
const mine = computed(() => describeEntityEdit(props.change));
</script>

<template>
  <UAlert
    color="warning"
    variant="subtle"
    icon="i-lucide-triangle-alert"
    title="Changed since you opened it"
    data-testid="stale-edit"
  >
    <template #description>
      <div class="space-y-3">
        <p>
          Somebody changed {{ fields }} while you were editing. Yours was not saved; the page now
          shows what it says. Save yours over it, or leave theirs.
        </p>
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm" data-testid="stale-mine">
          <template v-for="line in mine" :key="line.field">
            <dt class="text-xs font-semibold uppercase tracking-wide text-muted">
              Your {{ line.field }}
            </dt>
            <dd class="whitespace-pre-wrap break-words">{{ line.value }}</dd>
          </template>
        </dl>
        <div class="flex flex-wrap gap-2">
          <UButton
            size="xs"
            color="warning"
            :loading="props.saving"
            data-testid="stale-reapply"
            @click="emit('reapply')"
          >
            Save mine over it
          </UButton>
          <UButton
            size="xs"
            color="neutral"
            variant="subtle"
            data-testid="stale-dismiss"
            @click="emit('dismiss')"
          >
            Leave theirs
          </UButton>
        </div>
      </div>
    </template>
  </UAlert>
</template>
