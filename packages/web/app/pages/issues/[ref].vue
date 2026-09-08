<!--
  One issue: what it says, what is under it, and what people said about it.

  Editing is in place and one field at a time, which is not a stylistic
  preference. `updateIssue` distinguishes an absent field from an explicit
  null, so sending the whole form on every save would rewrite frontmatter
  nobody touched; `buildEntityPatch` sends only what changed, and nothing at
  all when nothing did.
-->
<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import { FEATURES_QUERY, ISSUE_QUERY, ISSUES_QUERY } from "~/graphql/queries";
import { buildCommentTree, countComments } from "~/utils/comments";
import { distinctValues, shortId } from "~/utils/entities";
import { describeApiError, reparentConflict } from "~/utils/errors";
import {
  buildEntityPatch,
  type EntityEdit,
  normalizeOptional,
  PatchError,
  parseRankInput,
} from "~/utils/patch";
import { countSubtasks } from "~/utils/subtasks";

const route = useRoute();
const toast = useToast();
const mutations = useIssueMutations();

const reference = computed(() => String(route.params.ref ?? ""));

const { result, loading, error, refetch } = useQuery(
  ISSUE_QUERY,
  () => ({ ref: reference.value }),
  { fetchPolicy: "cache-and-network" },
);
const issue = computed(() => result.value?.issue ?? null);

/*
 * Suggestions for the sidebar's menus.
 *
 * There is no query that enumerates labels, assignees or milestones, so an
 * open listing is read alongside the issue purely to have something to offer.
 * It is one request, the answer is shared with the list page's cache entry,
 * and a suggestion list that is merely incomplete costs nothing — every menu
 * accepts a value that is not in it.
 */
const { result: listing } = useQuery(ISSUES_QUERY, { filter: {} }, { fetchPolicy: "cache-first" });
// Features are the exception: they are real directories, so their list is the
// registry rather than a guess made from whatever the listing mentions.
const { result: featureList } = useQuery(FEATURES_QUERY, undefined, {
  fetchPolicy: "cache-first",
});
const known = computed(() => {
  const issues = listing.value?.issues ?? [];
  return {
    labels: distinctValues(issues, (item) => item.labels),
    assignees: distinctValues(issues, (item) => item.assignees),
    milestones: distinctValues(issues, (item) => (item.milestone ? [item.milestone] : [])),
    features: (featureList.value?.features ?? []).map((feature) => feature.slug),
  };
});

const comments = computed(() => buildCommentTree(issue.value?.comments ?? []));
const commentCount = computed(() => countComments(comments.value));
const subtaskCount = computed(() => countSubtasks(issue.value?.subtasks ?? []));

/** The issue as the patch builder compares against. */
const current = computed<EntityEdit>(() => ({
  title: issue.value?.title ?? "",
  body: issue.value?.body ?? "",
  labels: [...(issue.value?.labels ?? [])],
  assignees: [...(issue.value?.assignees ?? [])],
  milestone: issue.value?.milestone ?? null,
  features: [...(issue.value?.features ?? [])],
  rank: issue.value?.rank ?? null,
  deadline: issue.value?.deadline ?? null,
}));

async function save(change: Partial<EntityEdit>): Promise<void> {
  if (issue.value === null) return;
  let patch: ReturnType<typeof buildEntityPatch>;
  try {
    patch = buildEntityPatch(current.value, change);
  } catch (failure) {
    if (!(failure instanceof PatchError)) throw failure;
    toast.add({ title: "That will not do", description: failure.message, color: "error" });
    return;
  }
  // Nothing changed. The server would refuse an empty patch, and it is right
  // to: an edit that says nothing is not an edit.
  if (patch === null) return;
  await mutations.updateIssue(issue.value.id, patch);
}

/* ------------------------------------------------------------- closing */

const closing = ref(false);
const resolution = ref("");
const duplicateOf = ref("");

async function confirmClose(): Promise<void> {
  if (issue.value === null) return;
  await mutations.closeIssue(
    issue.value.id,
    normalizeOptional(resolution.value),
    normalizeOptional(duplicateOf.value),
  );
  closing.value = false;
  resolution.value = "";
  duplicateOf.value = "";
}

/* ------------------------------------------------------------ comments */

const replyTo = ref<string | null>(null);
const replyToAuthor = computed(
  () => issue.value?.comments.find((item) => item.id === replyTo.value)?.author ?? null,
);
const commentForm = useTemplateRef<{ clear: () => void }>("commentForm");

async function addComment(body: string): Promise<void> {
  if (issue.value === null) return;
  const written = await mutations.addComment(issue.value.id, body, replyTo.value);
  // Only now: a failed write must leave what was written where it was typed.
  if (written === null) return;
  commentForm.value?.clear();
  replyTo.value = null;
}

/* -------------------------------------------------------------- linking */

const linking = ref(false);
const childRef = ref("");
/** Set when the server refused and asked whether the move was meant. */
const reparent = ref<{ child: string; currentParentTitle: string | null } | null>(null);

async function link(child: string, allowReparent: boolean): Promise<void> {
  if (issue.value === null) return;
  try {
    await mutations.linkIssue(child, issue.value.id, allowReparent);
    linking.value = false;
    reparent.value = null;
    childRef.value = "";
    // The payload carries both ends, so the cache already holds them — but a
    // reparent also changes a *third* issue, the one the subtask came from,
    // and no payload names it. Asking again is the only way to be right.
    await refetch();
  } catch (failure) {
    const conflict = reparentConflict(describeApiError(failure));
    if (conflict === null) {
      // Not the question we anticipated, so it is an error like any other and
      // the shared toast never saw it — this is where it gets said.
      const described = describeApiError(failure);
      toast.add({ title: "Could not link it", description: described.message, color: "error" });
      linking.value = false;
      return;
    }
    linking.value = false;
    reparent.value = { child, currentParentTitle: conflict.currentParentTitle };
  }
}

async function unlink(child: string): Promise<void> {
  await mutations.unlinkIssue(child);
  // `unlinkIssue` returns the child alone, so this issue's own tree — the
  // thing on screen — is only correct once it has been read again.
  await refetch();
}
</script>

<template>
  <QueryState
    :loading="loading && issue === null"
    :error="error"
    :skeleton-rows="5"
    @retry="refetch()"
  >
    <article v-if="issue" class="space-y-6" data-testid="issue-detail">
      <header class="space-y-2">
        <div v-if="issue.parent?.issue" class="text-sm text-muted">
          <UIcon name="i-lucide-corner-left-up" class="size-3.5" />
          under
          <NuxtLink :to="`/issues/${issue.parent.issue.id}`" class="hover:underline">
            {{ issue.parent.issue.title }}
          </NuxtLink>
        </div>

        <EditableText
          :value="issue.title"
          label="title"
          testid="title"
          required
          :saving="mutations.busy.value"
          @save="(title: string) => save({ title })"
        >
          <h1 class="text-2xl font-semibold" data-testid="issue-title">{{ issue.title }}</h1>
        </EditableText>

        <div class="flex flex-wrap items-center gap-2 text-sm text-muted">
          <StatusBadge :status="issue.status" />
          <code data-testid="issue-id">#{{ issue.id }}</code>
          <span>
            opened <TimeAgo :iso="issue.created" /> by <PersonLabel :person="issue.author" />
          </span>
          <span>· {{ commentCount }} comment{{ commentCount === 1 ? "" : "s" }}</span>
        </div>
      </header>

      <UAlert
        v-if="issue.status === 'CLOSED'"
        color="neutral"
        variant="subtle"
        icon="i-lucide-circle-check"
        title="This issue is closed"
        data-testid="closed-banner"
      >
        <template #description>
          <span v-if="issue.resolution">Resolution: {{ issue.resolution }}.</span>
          <span v-if="issue.duplicateOf">
            Duplicate of
            <NuxtLink :to="`/issues/${issue.duplicateOf}`" class="underline">
              #{{ shortId(issue.duplicateOf) }} </NuxtLink
            >.
          </span>
          <span v-if="!issue.resolution && !issue.duplicateOf">No resolution was recorded.</span>
        </template>
      </UAlert>

      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div class="space-y-6">
          <EditableText
            :value="issue.body"
            label="description"
            testid="body"
            multiline
            required
            :saving="mutations.busy.value"
            @save="(body: string) => save({ body })"
          >
            <MarkdownBody :source="issue.body" />
          </EditableText>

          <section class="space-y-2">
            <div class="flex items-center justify-between">
              <h2 class="font-semibold">
                Subtasks<span v-if="subtaskCount" class="text-muted"> ({{ subtaskCount }})</span>
              </h2>
              <UButton
                size="xs"
                color="neutral"
                variant="subtle"
                icon="i-lucide-link"
                data-testid="add-subtask"
                @click="linking = true"
              >
                Add subtask
              </UButton>
            </div>
            <SubtaskTree
              v-if="issue.subtasks.length"
              :nodes="issue.subtasks"
              unlinkable
              @unlink="unlink"
            />
            <p v-else class="text-sm text-muted">Nothing is filed under this issue.</p>
          </section>

          <section class="space-y-3">
            <h2 class="font-semibold">Discussion</h2>
            <div v-if="comments.length" class="space-y-3" data-testid="comment-thread">
              <CommentCard
                v-for="node in comments"
                :key="node.comment.id"
                :node="node"
                @reply="(id: string) => (replyTo = id)"
              />
            </div>
            <p v-else class="text-sm text-muted">No comments yet.</p>

            <CommentForm
              ref="commentForm"
              :reply-to="replyTo"
              :reply-to-author="replyToAuthor"
              :saving="mutations.busy.value"
              @submit="addComment"
              @cancel-reply="replyTo = null"
            />
          </section>
        </div>

        <aside class="space-y-5 lg:border-s lg:border-default lg:ps-6">
          <LabelEditor
            title="Labels"
            icon="i-lucide-tag"
            testid="labels"
            :values="issue.labels"
            :suggestions="known.labels"
            :saving="mutations.busy.value"
            @save="(labels: string[]) => save({ labels })"
          />
          <LabelEditor
            title="Assignees"
            icon="i-lucide-user"
            testid="assignees"
            :values="issue.assignees"
            :suggestions="known.assignees"
            :saving="mutations.busy.value"
            @save="(assignees: string[]) => save({ assignees })"
          />
          <LabelEditor
            title="Features"
            icon="i-lucide-layers"
            testid="features"
            link-to="/features/"
            :values="issue.features"
            :suggestions="known.features"
            :saving="mutations.busy.value"
            @save="(features: string[]) => save({ features })"
          />
          <LabelEditor
            title="Milestone"
            icon="i-lucide-flag"
            testid="milestone"
            single
            :values="issue.milestone ? [issue.milestone] : []"
            :suggestions="known.milestones"
            :saving="mutations.busy.value"
            @save="(values: string[]) => save({ milestone: values[0] ?? null })"
          />
          <!--
            A number and a day, so neither is a menu of what the listing
            happened to mention: what these two hold is not a word somebody
            else has already used.
          -->
          <FieldEditor
            title="Rank"
            icon="i-lucide-list-ordered"
            testid="rank"
            type="number"
            :value="issue.rank === null || issue.rank === undefined ? '' : String(issue.rank)"
            :saving="mutations.busy.value"
            @save="(text: string) => save({ rank: parseRankInput(text) })"
          />
          <FieldEditor
            title="Deadline"
            icon="i-lucide-calendar"
            testid="deadline"
            type="date"
            :value="issue.deadline ?? ''"
            :saving="mutations.busy.value"
            @save="(text: string) => save({ deadline: normalizeOptional(text) })"
          >
            <template #display>
              <DueDate v-if="issue.deadline" :deadline="issue.deadline" />
            </template>
          </FieldEditor>

          <section class="space-y-2 border-t border-default pt-4">
            <UButton
              v-if="issue.status === 'OPEN'"
              block
              color="neutral"
              variant="subtle"
              icon="i-lucide-circle-check"
              data-testid="close-issue"
              @click="closing = true"
            >
              Close issue
            </UButton>
            <UButton
              v-else
              block
              color="neutral"
              variant="subtle"
              icon="i-lucide-rotate-ccw"
              :loading="mutations.busy.value"
              data-testid="reopen-issue"
              @click="mutations.reopenIssue(issue.id)"
            >
              Reopen issue
            </UButton>
            <p class="break-all text-xs text-muted">{{ issue.path }}</p>
          </section>
        </aside>
      </div>
    </article>

    <!-- Closing: a resolution, and the issue this one duplicates. -->
    <UModal v-model:open="closing" title="Close this issue">
      <template #body>
        <div class="space-y-4">
          <UFormField
            label="Resolution"
            description="Why it ended. Free text; fixed, wontfix and duplicate are the usual ones."
          >
            <UInput
              v-model="resolution"
              placeholder="fixed"
              class="w-full"
              data-testid="close-resolution"
            />
          </UFormField>
          <UFormField label="Duplicate of" description="The issue this one duplicates, if any.">
            <UInput
              v-model="duplicateOf"
              placeholder="an id or an unambiguous prefix"
              class="w-full"
              data-testid="close-duplicate-of"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="closing = false">Cancel</UButton>
          <UButton
            :loading="mutations.busy.value"
            data-testid="confirm-close"
            @click="confirmClose"
          >
            Close issue
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Linking a subtask. -->
    <UModal v-model:open="linking" title="File an issue under this one">
      <template #body>
        <UFormField
          label="Issue"
          description="An id, or an unambiguous prefix of at least four characters."
        >
          <UInput
            v-model="childRef"
            placeholder="ab12cd34"
            class="w-full"
            data-testid="link-child-ref"
            @keydown.enter="link(childRef, false)"
          />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="linking = false">Cancel</UButton>
          <UButton
            :disabled="childRef.trim() === ''"
            :loading="mutations.busy.value"
            data-testid="confirm-link"
            @click="link(childRef, false)"
          >
            Link
          </UButton>
        </div>
      </template>
    </UModal>

    <!--
      The server refused because the issue already has a parent, and moving a
      subtask changes a structure somebody else may be reading. So it is asked
      rather than assumed, and the second attempt carries the consent.
    -->
    <UModal :open="reparent !== null" title="It already has a parent" data-testid="reparent-modal">
      <template #body>
        <p class="text-sm">
          <code>#{{ reparent?.child }}</code> is currently filed under
          <strong>{{ reparent?.currentParentTitle ?? "another issue" }}</strong
          >. Moving it changes a tree somebody else may be reading.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="reparent = null">Leave it</UButton>
          <UButton
            :loading="mutations.busy.value"
            data-testid="confirm-reparent"
            @click="reparent && link(reparent.child, true)"
          >
            Move it here
          </UButton>
        </div>
      </template>
    </UModal>
  </QueryState>
</template>
