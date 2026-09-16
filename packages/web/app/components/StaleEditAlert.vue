<!--
  An edit the server refused as stale, kept until the person decides.

  The field editors close on save, so by the time the refusal arrives the words
  are no longer in an input; this is where they are kept. What was typed is the
  only copy of itself, and a page that discarded it to show an error would be
  doing the losing the refusal exists to prevent. The page behind this alert
  has been fetched again, so it shows what the file says now.

  Why it was refused is said in the server's words, because they are the
  accurate ones: usually that somebody changed the field first, sometimes that
  the version the page was read from is one the server cannot find, which is
  not the same thing and must not be reported as if it were.

  Then the decision is the person's, which is the point of surfacing a conflict
  rather than resolving it (spec 06 §6.3): save theirs over what is there,
  having seen it, or leave it. Nothing here picks one.
-->
<script setup lang="ts">
import { describeEntityEdit, type EntityEdit } from "~/utils/patch";

const props = defineProps<{
  /** The server's own sentence about the refusal. */
  message: string;
  /** The edit that was refused, as it was sent. */
  change: Partial<EntityEdit>;
  /** True while a save is out, or the page is still being read again. */
  saving?: boolean;
}>();

const emit = defineEmits<{ reapply: []; dismiss: [] }>();

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
        <p data-testid="stale-why">
          {{ props.message }}. What you typed was not saved; the page now shows what the file
          says. Save yours over it, or leave theirs.
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
            :disabled="props.saving"
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
