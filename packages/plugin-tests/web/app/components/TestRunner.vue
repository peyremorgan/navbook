<!--
  A run's steps: read, or recorded.

  While a run is open and this server can write it, each step takes a status
  and what the tester saw. Answers are a draft held in the browser — kept
  across a reload, per run — and nothing is written until **Save progress** or
  **Finish**, each one commit. A tester can walk away halfway and come back.

  A save carries the hash of the run file the draft was made against, and one
  made against a version somebody has since changed is refused: the draft
  stays, and the tester chooses to write theirs over it or take what is there
  now (spec 06 §6.3). A run in a pull request this server does not hold is
  refused with the branch that does, as a comment on it would be.
-->
<script setup lang="ts">
import { useApolloClient } from "@vue/apollo-composable";
import type { SaidFailure } from "~/utils/errors";
import type { TestRunDetailFragment } from "../../src/generated/gql/graphql";
import { otherRefusal, refusedBranch, staleContent } from "../composables/useTestMutations";
import { TEST_RUN_QUERY } from "../graphql/queries";
import {
  base64Of,
  changedSteps,
  type DraftStep,
  draftDiffers,
  draftFromRun,
  draftKey,
  markAttachments,
  parseDraft,
  type RunDraft,
} from "../utils/tests";

const props = defineProps<{ run: TestRunDetailFragment; writable: boolean }>();

const mutations = useTestMutations();
const apollo = useApolloClient();
const saved = computed(() => draftFromRun(props.run));

/** The draft kept for this run, if one outlived a reload; otherwise what the server has. */
function restore(): RunDraft {
  try {
    const kept = parseDraft(localStorage.getItem(draftKey(props.run.id)));
    if (kept !== null && draftDiffers(kept, saved.value)) return kept;
  } catch {
    // Storage refused (a private window, say): the draft lives for this page only.
  }
  return draftFromRun(props.run);
}

const draft = ref<RunDraft>(restore());
const stale = ref<string | null>(null);
const refused = ref<string | null>(null);
const other = ref<SaidFailure | null>(null);
const confirming = ref(false);
const dirty = computed(() => draftDiffers(draft.value, saved.value));

useUnsavedWork(() => props.writable && dirty.value);

// Kept in the browser while it differs from the server, and forgotten once saved.
watch(
  draft,
  (value) => {
    try {
      if (draftDiffers(value, saved.value))
        localStorage.setItem(draftKey(props.run.id), JSON.stringify(value));
      else localStorage.removeItem(draftKey(props.run.id));
    } catch {
      // Nowhere to keep it; the page still holds it.
    }
  },
  { deep: true },
);

/**
 * The run changed on the server — our own save coming back, or somebody
 * else's. With nothing unsaved here, take it; with a draft, keep the draft:
 * it is the only copy of itself, and the next save says whether it is stale.
 */
watch(saved, (next, previous) => {
  if (!draftDiffers(draft.value, previous)) draft.value = next;
});

const recorded = computed(() => Object.keys(draft.value.steps).length);
const unrecorded = computed(() => props.run.results.length - recorded.value);

function statusOf(number: number): DraftStep["status"] | null {
  return draft.value.steps[number]?.status ?? null;
}

function choose(number: number, status: DraftStep["status"]): void {
  const current = draft.value.steps[number];
  draft.value.steps[number] = { status, actual: current?.actual ?? "" };
}

function setActual(number: number, text: string): void {
  const current = draft.value.steps[number];
  if (current) current.actual = text;
}

async function save(finish: boolean, over = false): Promise<void> {
  confirming.value = false;
  refused.value = null;
  other.value = null;
  stale.value = null;
  try {
    const payload = await mutations.saveRun({
      id: props.run.id,
      baseSha: over ? props.run.baseSha : draft.value.baseSha,
      results: changedSteps(draft.value, saved.value),
      notes: draft.value.notes.trim() === saved.value.notes.trim() ? null : draft.value.notes,
      finish,
    });
    if (payload) draft.value = draftFromRun(payload.run);
  } catch (error) {
    await refusal(error);
  }
}

function finish(): void {
  if (unrecorded.value > 0 && !confirming.value) {
    confirming.value = true;
    return;
  }
  void save(true);
}

/** Answer a refused save or attach: on another branch, stale, or anything else. */
async function refusal(error: unknown): Promise<void> {
  const branch = refusedBranch(error);
  if (branch !== null) {
    refused.value = branch;
    return;
  }
  other.value = otherRefusal(error);
  await refusedAsStale(error);
}

/**
 * Say a save was refused as stale, then read what the run says now — in that
 * order, so the draft is kept when the new version arrives (see the watcher on
 * `saved`), and "Save mine anyway" carries the hash of what it overwrites.
 */
async function refusedAsStale(error: unknown): Promise<void> {
  const message = staleContent(error);
  if (message === null) return;
  stale.value = message;
  await apollo.client
    .query({ query: TEST_RUN_QUERY, variables: { id: props.run.id }, fetchPolicy: "network-only" })
    .catch(() => undefined);
}

/** Throw the draft away for what the server holds now. */
function takeTheirs(): void {
  stale.value = null;
  draft.value = draftFromRun(props.run);
}

async function attach(number: number | null, event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = "";
  if (files.length === 0) return;
  const read = await Promise.all(
    files.map(
      (file) =>
        new Promise<{ name: string; base64: string }>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve({ name: file.name, base64: base64Of(String(reader.result)) });
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        }),
    ),
  );
  refused.value = null;
  other.value = null;
  stale.value = null;
  try {
    const payload = await mutations.attach({
      id: props.run.id,
      baseSha: props.run.baseSha,
      files: read,
      ...(number === null ? {} : { step: number }),
    });
    if (payload) draft.value = draftFromRun(payload.run);
  } catch (error) {
    await refusal(error);
  }
}

const STATUSES: {
  value: DraftStep["status"];
  label: string;
  color: "success" | "error" | "warning" | "neutral";
}[] = [
  { value: "PASSED", label: "Passed", color: "success" },
  { value: "FAILED", label: "Failed", color: "error" },
  { value: "BLOCKED", label: "Blocked", color: "warning" },
  { value: "SKIPPED", label: "Skipped", color: "neutral" },
];
</script>

<template>
  <div class="space-y-4" data-testid="test-runner">
    <UAlert
      v-if="refused"
      color="warning"
      variant="subtle"
      icon="i-lucide-git-branch"
      title="This run cannot be recorded from here"
      data-testid="runner-unserved"
    >
      <template #description>
        It lives beside its pull request on <code>{{ refused }}</code>, which this server does not have checked out.
        Serve a checkout of that branch, or record it from a terminal there with <code>nav test resume {{ props.run.id }}</code>.
      </template>
    </UAlert>
    <UAlert
      v-if="other"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-x"
      :title="other.heading"
      :description="other.message"
      data-testid="runner-refused"
    />
    <UAlert
      v-if="stale"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Changed since you opened it"
      data-testid="runner-stale"
    >
      <template #description>
        {{ stale }}. Your answers are still here; the steps below show them over what the run says now.
      </template>
      <template #actions>
        <UButton size="xs" color="warning" data-testid="runner-save-over" @click="save(false, true)">
          Save mine anyway
        </UButton>
        <UButton size="xs" color="neutral" variant="ghost" data-testid="runner-take-theirs" @click="takeTheirs">
          Take theirs
        </UButton>
      </template>
    </UAlert>

    <ol class="space-y-3">
      <li
        v-for="step in props.run.results"
        :key="step.number"
        class="space-y-2 rounded-lg border border-default p-3"
        :data-testid="`runner-step-${step.number}`"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-semibold">{{ step.number }}. {{ step.title }}</span>
          <TestStateBadge :state="statusOf(step.number)" :data-testid="`runner-step-${step.number}-state`" />
        </div>
        <div class="grid gap-3 text-sm md:grid-cols-2">
          <div>
            <p class="text-xs font-medium uppercase text-muted">Actions</p>
            <MarkdownBody v-if="step.actions" :source="step.actions" />
            <p v-else class="text-muted">The plan is not in hand; see its file.</p>
          </div>
          <div>
            <p class="text-xs font-medium uppercase text-muted">Expected</p>
            <MarkdownBody v-if="step.expected" :source="step.expected" />
            <p v-else class="text-muted">A setup step: nothing to check.</p>
          </div>
        </div>

        <template v-if="props.writable">
          <div class="flex flex-wrap gap-1.5">
            <UButton
              v-for="choice in STATUSES"
              :key="choice.value"
              size="xs"
              :color="choice.color"
              :variant="statusOf(step.number) === choice.value ? 'solid' : 'outline'"
              :data-testid="`runner-step-${step.number}-${choice.value.toLowerCase()}`"
              @click="choose(step.number, choice.value)"
            >
              {{ choice.label }}
            </UButton>
          </div>
          <UTextarea
            v-if="statusOf(step.number)"
            :model-value="draft.steps[step.number]?.actual ?? ''"
            :rows="2"
            autoresize
            class="w-full"
            placeholder="What happened (optional)"
            :data-testid="`runner-step-${step.number}-actual`"
            @update:model-value="(text: string) => setActual(step.number, text)"
          />
          <label
            v-if="step.status && !dirty"
            class="inline-flex cursor-pointer items-center gap-1 text-xs text-muted hover:text-default"
          >
            <UIcon name="i-lucide-paperclip" class="size-3" /> Attach files to this step
            <input
              type="file"
              multiple
              class="hidden"
              :data-testid="`runner-step-${step.number}-attach`"
              @change="attach(step.number, $event)"
            />
          </label>
        </template>
        <div v-else-if="step.actual" class="text-sm">
          <p class="text-xs font-medium uppercase text-muted">Actual</p>
          <MarkdownBody :source="markAttachments(step.actual, props.run.path)" />
        </div>
      </li>
    </ol>

    <section class="space-y-2">
      <p class="text-xs font-medium uppercase text-muted">Notes</p>
      <UTextarea
        v-if="props.writable"
        v-model="draft.notes"
        :rows="2"
        autoresize
        class="w-full"
        placeholder="Anything about the run as a whole"
        data-testid="runner-notes"
      />
      <MarkdownBody v-else-if="props.run.notes" :source="markAttachments(props.run.notes, props.run.path)" />
      <p v-else class="text-sm text-muted">None.</p>
    </section>

    <div v-if="props.writable" class="flex flex-wrap items-center gap-2">
      <UButton
        :disabled="!dirty"
        :loading="mutations.busy.value"
        color="neutral"
        variant="subtle"
        icon="i-lucide-save"
        data-testid="runner-save"
        @click="save(false)"
      >
        Save progress
      </UButton>
      <UButton
        v-if="!confirming"
        :loading="mutations.busy.value"
        icon="i-lucide-flag"
        data-testid="runner-finish"
        @click="finish"
      >
        Finish
      </UButton>
      <template v-else>
        <span class="text-sm text-muted" data-testid="runner-finish-warning">
          {{ unrecorded }} {{ unrecorded === 1 ? "step is" : "steps are" }} not recorded, and will stay not run.
        </span>
        <UButton color="warning" data-testid="runner-finish-confirm" @click="finish">Finish anyway</UButton>
        <UButton color="neutral" variant="ghost" @click="confirming = false">Keep going</UButton>
      </template>
      <span class="flex-1" />
      <label v-if="!dirty" class="inline-flex cursor-pointer items-center gap-1 text-sm text-muted hover:text-default">
        <UIcon name="i-lucide-paperclip" class="size-4" /> Attach to the run
        <input type="file" multiple class="hidden" data-testid="runner-attach" @change="attach(null, $event)" />
      </label>
      <span v-else class="text-xs text-muted">Save your answers to attach files.</span>
    </div>
  </div>
</template>
