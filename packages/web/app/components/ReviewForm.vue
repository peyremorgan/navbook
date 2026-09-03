<!--
  Commenting on a pull request, with or without a verdict.

  A verdict is what turns a comment into a review, and a review binds to one
  recorded revision — that is the whole reason the field exists: an approval
  belongs to the state of the branch it judged, so a force-push cannot inherit
  it. The revision defaults to the latest and can be pointed at an older one,
  which is what you want when reviewing a revision that has since been
  superseded.

  The file and line are only meaningful on a review, and the server says so
  (`INVALID_INPUT`), so they appear only once a verdict is chosen.
-->
<script setup lang="ts">
import { shortSha } from "~/utils/entities";
import type { PrDetailFragment, Verdict } from "~~/src/generated/gql/graphql";

const props = defineProps<{
  revisions: PrDetailFragment["revisions"];
  replyTo?: string | null;
  replyToAuthor?: string | null;
  saving?: boolean;
  /** Set when this server cannot accept a comment, naming the branch to serve. */
  unservedBranch?: string | null;
}>();

const emit = defineEmits<{
  submit: [
    {
      body: string;
      verdict: Verdict | null;
      revision: string | null;
      file: string | null;
      line: string | null;
    },
  ];
  cancelReply: [];
}>();

const body = ref("");
const verdict = ref<Verdict | "NONE">("NONE");
const revision = ref<string>("");
const file = ref("");
const line = ref("");

/** Newest first, as the API returns them; the first is what a review defaults to. */
const options = computed(() =>
  props.revisions.map((item, index) => ({
    label: `${shortSha(item.head)}${index === 0 ? " (latest)" : ""}`,
    value: item.head,
  })),
);

const verdicts = [
  { label: "Comment only", value: "NONE" as const },
  { label: "Approve", value: "APPROVE" as const },
  { label: "Request changes", value: "REQUEST_CHANGES" as const },
];

const reviewing = computed(() => verdict.value !== "NONE");

function submit(): void {
  const text = body.value.trim();
  if (text === "") return;
  emit("submit", {
    body: text,
    verdict: reviewing.value ? (verdict.value as Verdict) : null,
    // Only ever sent with a verdict: the server refuses review fields on a
    // plain comment, and a comment that quietly became a review would be worse.
    revision: reviewing.value && revision.value !== "" ? revision.value : null,
    file: reviewing.value && file.value.trim() !== "" ? file.value.trim() : null,
    line: reviewing.value && line.value.trim() !== "" ? line.value.trim() : null,
  });
}

defineExpose({ clear: () => (body.value = "") });
</script>

<template>
  <div class="space-y-3">
    <UAlert
      v-if="props.unservedBranch"
      color="warning"
      variant="subtle"
      icon="i-lucide-git-branch"
      title="This pull request cannot be commented on from here"
      data-testid="unserved-branch"
    >
      <template #description>
        Its files live on <code>{{ props.unservedBranch }}</code
        >, which this server does not have checked out. A comment must be written beside the pull
        request it belongs to, so serve a checkout of that branch to review it.
      </template>
    </UAlert>

    <form class="space-y-3" data-testid="review-form" @submit.prevent="submit">
      <div v-if="props.replyTo" class="flex items-center gap-2 text-sm text-muted">
        <UIcon name="i-lucide-reply" class="size-4" />
        <span>
          Replying to
          <PersonLabel v-if="props.replyToAuthor" :person="props.replyToAuthor" />
          <code v-else>#{{ props.replyTo }}</code>
        </span>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          data-testid="cancel-reply"
          @click="emit('cancelReply')"
        />
      </div>

      <UTextarea
        v-model="body"
        :rows="4"
        autoresize
        class="w-full"
        aria-label="Comment"
        data-testid="review-body"
        placeholder="Leave a comment, or record a verdict against a revision."
      />

      <URadioGroup
        v-model="verdict"
        :items="verdicts"
        orientation="horizontal"
        legend="Verdict"
        data-testid="review-verdict"
      />

      <div v-if="reviewing" class="grid gap-3 sm:grid-cols-3">
        <UFormField label="Revision" description="Which state of the branch this judges.">
          <USelect
            v-model="revision"
            :items="options"
            placeholder="latest"
            class="w-full"
            data-testid="review-revision"
          />
        </UFormField>
        <UFormField label="File" description="Optional.">
          <UInput v-model="file" class="w-full" data-testid="review-file" />
        </UFormField>
        <UFormField label="Line" description="A number, or start-end.">
          <UInput v-model="line" class="w-full" placeholder="42-48" data-testid="review-line" />
        </UFormField>
      </div>

      <UButton
        type="submit"
        size="sm"
        :disabled="body.trim() === '' || props.unservedBranch != null"
        :loading="props.saving"
        data-testid="review-submit"
      >
        {{ reviewing ? "Submit review" : "Comment" }}
      </UButton>
    </form>
  </div>
</template>
