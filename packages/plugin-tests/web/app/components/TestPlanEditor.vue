<!--
  A plan, edited as fields: its title, its description, and its steps.

  The client sends fields and the server composes `plan.md` (spec 06 §6.3), so
  nothing here can write a file the grammar would misread. What it checks
  before sending is what the server would refuse anyway — a step with no title
  or no actions — so the refusal is shown beside the field rather than toasted.

  A save made against a plan somebody has since changed is refused, and the
  draft stays: the editor keeps what was typed and shows what the plan says
  now, and the author decides with both in front of them.
-->
<script setup lang="ts">
import type { TestPlanDetailFragment } from "../../src/generated/gql/graphql";

interface StepDraft {
  key: number;
  title: string;
  actions: string;
  expected: string;
}

const props = defineProps<{
  /** The plan being edited; absent for a new one. */
  plan?: TestPlanDetailFragment | null;
  saving?: boolean;
  /** The message a stale save was refused with. */
  stale?: string | null;
}>();

const emit = defineEmits<{
  save: [
    {
      title: string;
      slug: string | null;
      description: string;
      steps: { title: string; actions: string; expected: string | null }[];
    },
  ];
  cancel: [];
}>();

let nextKey = 0;
const draftOf = (step: {
  title: string;
  actions: string;
  expected?: string | null;
}): StepDraft => ({
  key: nextKey++,
  title: step.title,
  actions: step.actions,
  expected: step.expected ?? "",
});

const title = ref(props.plan?.title ?? "");
const slug = ref("");
const description = ref(props.plan?.description ?? "");
const steps = ref<StepDraft[]>(
  props.plan ? props.plan.steps.map(draftOf) : [draftOf({ title: "", actions: "", expected: "" })],
);
const problem = ref<string | null>(null);

const original = computed(() =>
  JSON.stringify({
    title: props.plan?.title ?? "",
    description: props.plan?.description ?? "",
    steps: (props.plan?.steps ?? []).map((step) => [step.title, step.actions, step.expected ?? ""]),
  }),
);
const current = computed(() =>
  JSON.stringify({
    title: title.value,
    description: description.value,
    steps: steps.value.map((step) => [step.title, step.actions, step.expected]),
  }),
);
useUnsavedWork(() =>
  props.plan
    ? current.value !== original.value
    : title.value.trim() !== "" ||
      steps.value.some((step) => step.title.trim() !== "" || step.actions.trim() !== ""),
);

function add(): void {
  steps.value.push(draftOf({ title: "", actions: "", expected: "" }));
}

function remove(index: number): void {
  steps.value.splice(index, 1);
}

function move(index: number, by: -1 | 1): void {
  const target = index + by;
  if (target < 0 || target >= steps.value.length) return;
  const [step] = steps.value.splice(index, 1);
  if (step) steps.value.splice(target, 0, step);
}

function save(): void {
  if (title.value.trim() === "") {
    problem.value = "A plan needs a title.";
    return;
  }
  const missing = steps.value.findIndex(
    (step) => step.title.trim() === "" || step.actions.trim() === "",
  );
  if (missing !== -1) {
    problem.value = `Step ${missing + 1} needs a title and its actions.`;
    return;
  }
  problem.value = null;
  emit("save", {
    title: title.value.trim(),
    slug: slug.value.trim() === "" ? null : slug.value.trim(),
    description: description.value.trim(),
    steps: steps.value.map((step) => ({
      title: step.title.trim().replace(/\s+/g, " "),
      actions: step.actions.trim(),
      expected: step.expected.trim() === "" ? null : step.expected.trim(),
    })),
  });
}
</script>

<template>
  <form class="space-y-4" data-testid="test-plan-editor" @submit.prevent="save">
    <UAlert
      v-if="props.stale"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Changed since you opened it"
      :description="`${props.stale}. Your draft is still here; the plan as it is now is shown on the page.`"
      data-testid="test-plan-stale"
    />

    <UFormField label="Title" required>
      <UInput v-model="title" class="w-full" placeholder="What this plan tests" data-testid="plan-title" />
    </UFormField>
    <UFormField
      v-if="!props.plan"
      label="Directory"
      description="Optional: derived from the title when left empty."
    >
      <UInput v-model="slug" class="w-full" placeholder="login-flow" data-testid="plan-slug" />
    </UFormField>
    <UFormField label="Description" description="What it covers, and what the tester needs before starting. Markdown.">
      <UTextarea v-model="description" :rows="3" autoresize class="w-full" data-testid="plan-description" />
    </UFormField>

    <ol class="space-y-3">
      <li
        v-for="(step, index) in steps"
        :key="step.key"
        class="space-y-2 rounded-lg border border-default p-3"
        :data-testid="`plan-step-${index + 1}`"
      >
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold text-muted">{{ index + 1 }}.</span>
          <UInput
            v-model="step.title"
            class="flex-1"
            placeholder="What this step is"
            :data-testid="`plan-step-${index + 1}-title`"
          />
          <UButton
            icon="i-lucide-arrow-up"
            color="neutral"
            variant="ghost"
            size="sm"
            :disabled="index === 0"
            aria-label="Move up"
            :data-testid="`plan-step-${index + 1}-up`"
            @click="move(index, -1)"
          />
          <UButton
            icon="i-lucide-arrow-down"
            color="neutral"
            variant="ghost"
            size="sm"
            :disabled="index === steps.length - 1"
            aria-label="Move down"
            :data-testid="`plan-step-${index + 1}-down`"
            @click="move(index, 1)"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="sm"
            aria-label="Remove step"
            :data-testid="`plan-step-${index + 1}-remove`"
            @click="remove(index)"
          />
        </div>
        <UFormField label="Actions" description="What the tester does. Markdown.">
          <UTextarea
            v-model="step.actions"
            :rows="2"
            autoresize
            class="w-full"
            :data-testid="`plan-step-${index + 1}-actions`"
          />
        </UFormField>
        <UFormField label="Expected" description="What they should see. Leave empty for a step that checks nothing.">
          <UTextarea
            v-model="step.expected"
            :rows="2"
            autoresize
            class="w-full"
            :data-testid="`plan-step-${index + 1}-expected`"
          />
        </UFormField>
      </li>
    </ol>

    <div class="flex flex-wrap items-center gap-2">
      <UButton icon="i-lucide-plus" color="neutral" variant="subtle" data-testid="plan-add-step" @click="add">
        Add a step
      </UButton>
      <span class="flex-1" />
      <p v-if="problem" class="text-sm text-error" data-testid="plan-problem">{{ problem }}</p>
      <UButton type="submit" :loading="props.saving" data-testid="plan-save">
        {{ props.plan ? "Save plan" : "Create plan" }}
      </UButton>
      <UButton color="neutral" variant="ghost" data-testid="plan-cancel" @click="emit('cancel')">Cancel</UButton>
    </div>
  </form>
</template>
