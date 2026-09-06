<!--
  A specification document: read, and edited.

  A document is longer than an issue's description and is prose several people
  work on, so this is the one place in the client with a preview: what
  Markdown will do to what you typed, rendered by the same function that
  renders it everywhere else. Nothing new is parsed — `renderMarkdown` is the
  only path from text to HTML there is.

  A save carries the hash the editor started from, and the server refuses one
  made against a version somebody has since replaced. That refusal is shown
  here, above the editor, with the draft still in it: what was typed is the
  only copy of itself, and a page that threw it away to show an error would be
  doing the losing that the refusal exists to prevent.
-->
<script setup lang="ts">
import type { SpecDetailFragment } from "~~/src/generated/gql/graphql";

const props = defineProps<{
  spec: SpecDetailFragment;
  saving?: boolean;
  /** The message shown when the server refused a save as out of date. */
  stale?: string | null;
}>();

const emit = defineEmits<{
  save: [{ title: string; body: string; baseSha: string }];
  reload: [];
}>();

const editing = ref(false);
const tab = ref<"write" | "preview">("write");
const title = ref(props.spec.title);
const body = ref(props.spec.body);
const problem = ref<string | null>(null);

watch(
  () => props.spec,
  (next) => {
    // While editing, only the hash is taken: the text on screen is the reader's
    // work, and a refetch behind them must not overwrite it.
    if (editing.value) return;
    title.value = next.title;
    body.value = next.body;
  },
);

function open(): void {
  title.value = props.spec.title;
  body.value = props.spec.body;
  problem.value = null;
  tab.value = "write";
  editing.value = true;
}

function cancel(): void {
  editing.value = false;
  problem.value = null;
}

function save(): void {
  if (title.value.trim() === "") {
    problem.value = "a title is required";
    return;
  }
  if (body.value.trim() === "") {
    problem.value = "a document with nothing in it says nothing";
    return;
  }
  problem.value = null;
  emit("save", {
    title: title.value.trim(),
    body: body.value.trim(),
    baseSha: props.spec.baseSha,
  });
}

/** Leave edit mode once a save has landed, which is a new hash arriving. */
watch(
  () => props.spec.baseSha,
  () => {
    if (editing.value && props.stale == null) editing.value = false;
  },
);
</script>

<template>
  <section class="space-y-3" data-testid="spec-editor">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 v-if="!editing" class="text-2xl font-semibold" data-testid="spec-title">
        {{ props.spec.title }}
      </h1>
      <UInput
        v-else
        v-model="title"
        class="max-w-lg flex-1"
        placeholder="What this document is called"
        data-testid="input-spec-title"
      />

      <div class="flex items-center gap-1.5">
        <UButton
          v-if="!editing"
          size="sm"
          color="neutral"
          variant="subtle"
          icon="i-lucide-pencil"
          data-testid="edit-spec"
          @click="open"
        >
          Edit
        </UButton>
        <template v-else>
          <UButton
            size="sm"
            :loading="props.saving"
            data-testid="save-spec"
            @click="save"
          >
            Save
          </UButton>
          <UButton size="sm" color="neutral" variant="ghost" data-testid="cancel-spec" @click="cancel">
            Cancel
          </UButton>
        </template>
      </div>
    </div>

    <UAlert
      v-if="props.stale"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Changed since you opened it"
      :description="props.stale"
      data-testid="spec-stale"
    >
      <template #actions>
        <UButton size="xs" color="neutral" variant="subtle" data-testid="spec-reload" @click="emit('reload')">
          Load what it says now
        </UButton>
      </template>
    </UAlert>

    <template v-if="editing">
      <div class="flex gap-1">
        <UButton
          v-for="pane in (['write', 'preview'] as const)"
          :key="pane"
          size="xs"
          color="neutral"
          :variant="tab === pane ? 'subtle' : 'ghost'"
          :aria-pressed="tab === pane"
          :data-testid="`spec-tab-${pane}`"
          @click="tab = pane"
        >
          {{ pane === "write" ? "Write" : "Preview" }}
        </UButton>
      </div>

      <UTextarea
        v-if="tab === 'write'"
        v-model="body"
        :rows="24"
        autoresize
        class="w-full font-mono"
        data-testid="input-spec-body"
      />
      <div v-else class="rounded-lg border border-default px-3 py-2" data-testid="spec-preview">
        <MarkdownBody :source="body" />
      </div>

      <p v-if="problem" class="text-sm text-error" data-testid="error-spec">{{ problem }}</p>
    </template>

    <MarkdownBody v-else :source="props.spec.body" />
  </section>
</template>
