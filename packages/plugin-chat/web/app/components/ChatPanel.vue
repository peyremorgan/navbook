<!--
  The conversation: what was said, what the assistant did, and the prompt.

  The assistant's words are Markdown, rendered by the host's `MarkdownBody` —
  the one place the client turns data into HTML, sanitised — so a reply reads
  like an issue body and its `#id` references are links. Each tool it used is
  one line. A write waiting for the person is a card instead, with what it
  will write and the two buttons that decide it; nothing is written until one
  is pressed, unless the Edits selector under the prompt says "Allow all".
-->
<script setup lang="ts">
import type { ToolPart } from "../utils/chat-state";

const session = useChatSession();
const draft = ref("");

const MODES = [
  { label: "Manual", value: "manual", icon: "i-lucide-hand" },
  { label: "Allow all", value: "allow-all", icon: "i-lucide-zap" },
];

const TOOL_WORDS: Record<string, string> = {
  list_issues: "Listed issues",
  list_prs: "Listed pull requests",
  show: "Read",
  open_issue: "Open an issue",
  open_pr: "Open a pull request",
  review_pr: "Review",
  comment: "Comment",
  close_issue: "Close an issue",
  reopen_issue: "Reopen an issue",
};

const messages = computed(() => session.state.messages as unknown as never[]);
const status = computed(() => session.state.status);
const waiting = computed(() =>
  session.state.messages.some((message) =>
    message.parts.some((part) => part.type !== "text" && part.state === "awaiting"),
  ),
);

function submit(): void {
  const text = draft.value;
  if (text.trim() === "" || session.busy.value) return;
  draft.value = "";
  void session.send(text);
}

function toolText(part: ToolPart): string {
  const name = TOOL_WORDS[part.toolName] ?? part.toolName;
  switch (part.state) {
    case "running":
      return `${name}…`;
    case "declined":
      return `${name}: declined`;
    default:
      return part.summary ? `${name}: ${part.summary}` : name;
  }
}

function toolIcon(part: ToolPart): string {
  if (part.state === "failed") return "i-lucide-circle-x";
  if (part.state === "declined") return "i-lucide-ban";
  return part.commit ? "i-lucide-git-commit-horizontal" : "i-lucide-search";
}

/** A write's arguments as the card lists them: everything but the body. */
function fields(part: ToolPart): [string, string][] {
  const input = (part.input ?? {}) as Record<string, unknown>;
  return Object.entries(input)
    .filter(([key]) => key !== "body")
    .map(([key, value]) => [
      key.replaceAll("_", " "),
      Array.isArray(value) ? value.join(", ") : String(value),
    ]);
}

function bodyOf(part: ToolPart): string {
  const body = (part.input as Record<string, unknown> | null)?.body;
  return typeof body === "string" ? body : "";
}

/** What was decided about a waiting write, while others still wait: null until then. */
function decisionOf(part: ToolPart): boolean | null {
  return session.state.decisions[part.toolCallId] ?? null;
}

function recordLink(part: ToolPart): string | null {
  if (!part.record) return null;
  return part.record.kind === "pr" ? `/prs/${part.record.id}` : `/issues/${part.record.id}`;
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-testid="chat-panel">
    <UChatPalette class="min-h-0 flex-1">
      <div
        v-if="session.state.messages.length === 0"
        class="space-y-2 p-4 text-sm text-muted"
        data-testid="chat-empty"
      >
        <p>Ask about this tracker in your own words, or ask for something to be done.</p>
        <p>“What is assigned to me?” · “Show me the overdue issues” · “File a bug about …”</p>
        <p>Every change is shown to you before it is made, unless Edits is set to Allow all.</p>
      </div>
      <UChatMessages
        v-else
        :messages="messages"
        :status="status"
        should-auto-scroll
        :assistant="{ variant: 'naked', side: 'left' }"
        data-testid="chat-messages"
      >
        <template #content="{ message }">
          <div class="space-y-2" :data-testid="`chat-${message.role}`">
            <template v-for="(part, index) in message.parts" :key="`${message.id}-${index}`">
              <template v-if="part.type === 'text'">
                <MarkdownBody v-if="message.role === 'assistant'" :source="part.text || ' '" />
                <p v-else class="whitespace-pre-wrap">{{ part.text }}</p>
              </template>
              <div
                v-else-if="part.state === 'awaiting'"
                class="space-y-2 rounded-md border border-default bg-elevated/40 p-3 text-sm"
                data-testid="chat-approval"
              >
                <p class="font-medium">{{ part.summary }}</p>
                <dl v-if="fields(part).length" class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <template v-for="[key, value] in fields(part)" :key="key">
                    <dt class="text-muted">{{ key }}</dt>
                    <dd class="break-words">{{ value }}</dd>
                  </template>
                </dl>
                <div v-if="bodyOf(part)" class="rounded border border-default bg-default p-2">
                  <MarkdownBody :source="bodyOf(part)" />
                </div>
                <p
                  v-if="decisionOf(part) !== null"
                  class="text-muted"
                  data-testid="chat-decided"
                >
                  {{ decisionOf(part) ? "Approved" : "Declined" }} — waiting for the other changes
                </p>
                <div v-else class="flex gap-2">
                  <UButton
                    label="Approve"
                    icon="i-lucide-check"
                    size="sm"
                    :disabled="session.busy.value"
                    data-testid="chat-approve"
                    @click="session.decide(part.toolCallId, true)"
                  />
                  <UButton
                    label="Decline"
                    icon="i-lucide-x"
                    size="sm"
                    color="neutral"
                    variant="outline"
                    :disabled="session.busy.value"
                    data-testid="chat-decline"
                    @click="session.decide(part.toolCallId, false)"
                  />
                </div>
              </div>
              <div v-else class="flex items-center gap-2" :data-testid="`chat-tool-${part.state}`">
                <UChatTool
                  :text="toolText(part)"
                  :icon="toolIcon(part)"
                  :loading="part.state === 'running'"
                  variant="inline"
                  class="min-w-0 flex-1"
                />
                <ULink v-if="recordLink(part)" :to="recordLink(part)!" class="text-xs text-primary" data-testid="chat-record">
                  #{{ part.record?.id }}
                </ULink>
              </div>
            </template>
          </div>
        </template>
      </UChatMessages>

      <template #prompt>
        <div data-testid="chat-prompt">
          <UAlert
            v-if="session.state.error"
            :description="session.state.error"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            class="mb-2"
            data-testid="chat-error"
          />
          <UChatPrompt
          v-model="draft"
          :placeholder="waiting ? 'Approve or decline above, or say something else' : 'Ask about issues and pull requests'"
          variant="subtle"
          @submit="submit"
        >
          <template #footer>
            <div class="flex items-center gap-2">
              <span class="text-xs text-muted" aria-hidden="true">Edits</span>
              <USelect
                v-model="session.mode.value"
                :items="MODES"
                size="xs"
                variant="ghost"
                aria-label="Edits"
                data-testid="chat-mode"
              />
              <UButton
                v-if="session.state.messages.length > 0"
                icon="i-lucide-rotate-ccw"
                size="xs"
                color="neutral"
                variant="ghost"
                aria-label="New conversation"
                data-testid="chat-reset"
                @click="session.reset()"
              />
            </div>
            <UChatPromptSubmit
              :status="status"
              data-testid="chat-submit"
              @stop="session.stop()"
              @reload="submit()"
            />
          </template>
        </UChatPrompt>
        </div>
      </template>
    </UChatPalette>
  </div>
</template>
