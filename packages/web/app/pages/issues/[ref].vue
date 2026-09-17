<!--
  One issue: what it says, what is under it, and what people said about it.

  Editing is in place and one field at a time, which is not a stylistic
  preference. `updateIssue` distinguishes an absent field from an explicit
  null, so sending the whole form on every save would rewrite frontmatter
  nobody touched; `buildEntityPatch` sends only what changed, and nothing at
  all when nothing did.

  Every save also says which version of the file it was edited from, and the
  server refuses one whose field somebody else changed in the meantime. What
  happens then is `useStaleEdit`'s: the refused edit is kept and shown beside
  what the page now says, and the decision is the person's.

  Every other outcome of a save is `usePendingEdits`'s. The page renders
  `shown` rather than the issue — the file with each edit in flight laid over
  it — so a save shows at once and stays shown while the server is busy
  committing and pushing it; a refusal is kept beside the field with a Retry.
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
import { entityTitle } from "~/utils/title";

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

// Named from the address at once and from the issue when it arrives, so a
// history entry carries the title rather than the reference somebody clicked.
useHead({
  title: computed(() =>
    issue.value === null
      ? entityTitle(reference.value)
      : entityTitle(issue.value.id, issue.value.title),
  ),
});

/*
 * Suggestions for the sidebar's menus.
 *
 * There is no query that enumerates labels or milestones, so an open listing
 * is read alongside the issue purely to have something to offer. It is one
 * request, the answer is shared with the list page's cache entry, and a
 * suggestion list that is merely incomplete costs nothing — every menu accepts
 * a value that is not in it.
 */
const { result: listing } = useQuery(ISSUES_QUERY, { filter: {} }, { fetchPolicy: "cache-first" });
// Features are one exception: they are real directories, so their list is the
// registry rather than a guess made from whatever the listing mentions.
const { result: featureList } = useQuery(FEATURES_QUERY, undefined, {
  fetchPolicy: "cache-first",
});
// People are the other, and a stronger one: a listing can only ever name
// somebody already written down somewhere, so the person nobody has assigned
// anything to yet — the one you most need to pick — is exactly the one it
// could never offer. The server reads them from its history and its tree.
const people = usePeople();
const known = computed(() => {
  const issues = listing.value?.issues ?? [];
  return {
    labels: distinctValues(issues, (item) => item.labels),
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

const staleEdits = useStaleEdit({ refetch, resend: (change) => save(change) });
const edits = usePendingEdits<EntityEdit>({
  resend: (change) => save(change),
  // A refusal that arrives after leaving the page has no field to sit under.
  lost: (failure) =>
    toast.add({ title: failure.heading, description: failure.message, color: "error" }),
});

/** The issue as the page shows it: the file, with every edit in flight over it. */
const shown = computed(() => edits.overlay(current.value));

async function save(change: Partial<EntityEdit>): Promise<void> {
  if (issue.value === null) return;
  let patch: ReturnType<typeof buildEntityPatch>;
  try {
    // Against what the file is about to say, not only what it says: typing
    // the old value back while the new one is still out is a change to send.
    patch = buildEntityPatch(edits.basis(current.value), change);
  } catch (failure) {
    if (!(failure instanceof PatchError)) throw failure;
    toast.add({ title: "That will not do", description: failure.message, color: "error" });
    return;
  }
  // Nothing changed. The server would refuse an empty patch, and it is right
  // to: an edit that says nothing is not an edit. It does settle a refused
  // edit of the same field, though — the page already says what was typed.
  if (patch === null) {
    staleEdits.settle(change);
    edits.settle(change);
    return;
  }
  const { id, baseSha } = issue.value;
  // A stale refusal is kept by `staleEdits`, beside what the file says now;
  // any other is kept by `edits`, beside the value it tried to set.
  await edits.attempt(change, () =>
    staleEdits.attempt(
      change,
      async () => (await mutations.updateIssue(id, patch, baseSha)) !== null,
    ),
  );
}

/* ------------------------------------------------------------- closing */

const closing = ref(false);
const resolution = ref("");
const duplicateOf = ref("");

async function confirmClose(): Promise<void> {
  if (issue.value === null) return;
  const closed = await mutations.closeIssue(
    issue.value.id,
    normalizeOptional(resolution.value),
    normalizeOptional(duplicateOf.value),
  );
  // Only once it landed: a refusal has been toasted, and the dialog stays up
  // holding the resolution that was typed rather than closing on it.
  if (closed === null) return;
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

/** The subtask being taken out, hidden from the tree until it has been read again. */
const unlinking = ref<string | null>(null);
const subtasksShown = computed(() =>
  (issue.value?.subtasks ?? []).filter((node) => node.id !== unlinking.value),
);

async function unlink(child: string): Promise<void> {
  unlinking.value = child;
  try {
    const done = await mutations.unlinkIssue(child);
    // `unlinkIssue` returns the child alone, so this issue's own tree — the
    // thing on screen — is only correct once it has been read again. A
    // refusal has been toasted, and the row comes back.
    if (done !== null) await refetch();
  } finally {
    unlinking.value = null;
  }
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
          :value="shown.title"
          label="title"
          testid="title"
          required
          :save="edits.field('title')"
          @save="(title: string) => save({ title })"
        >
          <h1 class="text-2xl font-semibold" data-testid="issue-title">{{ shown.title }}</h1>
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

      <StaleEditAlert
        v-if="staleEdits.stale.value"
        :message="staleEdits.stale.value.message"
        :change="staleEdits.stale.value.change"
        :saving="mutations.loading.update.value || staleEdits.refetching.value"
        @reapply="staleEdits.reapply"
        @dismiss="staleEdits.dismiss"
      />

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
            :value="shown.body"
            label="description"
            testid="body"
            multiline
            required
            :save="edits.field('body')"
            @save="(body: string) => save({ body })"
          >
            <MarkdownBody :source="shown.body" />
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
              v-if="subtasksShown.length"
              :nodes="subtasksShown"
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
              :saving="mutations.loading.comment.value"
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
            :values="shown.labels"
            :suggestions="known.labels"
            :save="edits.field('labels')"
            @save="(labels: string[]) => save({ labels })"
          />
          <LabelEditor
            title="Assignees"
            icon="i-lucide-user"
            testid="assignees"
            :values="shown.assignees"
            :suggestions="people"
            :save="edits.field('assignees')"
            @save="(assignees: string[]) => save({ assignees })"
          />
          <LabelEditor
            title="Features"
            icon="i-lucide-layers"
            testid="features"
            link-to="/features/"
            :values="shown.features"
            :suggestions="known.features"
            :save="edits.field('features')"
            @save="(features: string[]) => save({ features })"
          />
          <LabelEditor
            title="Milestone"
            icon="i-lucide-flag"
            testid="milestone"
            single
            :values="shown.milestone ? [shown.milestone] : []"
            :suggestions="known.milestones"
            :save="edits.field('milestone')"
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
            :value="shown.rank === null || shown.rank === undefined ? '' : String(shown.rank)"
            :save="edits.field('rank')"
            @save="(text: string) => save({ rank: parseRankInput(text) })"
          />
          <FieldEditor
            title="Deadline"
            icon="i-lucide-calendar"
            testid="deadline"
            type="date"
            :value="shown.deadline ?? ''"
            :save="edits.field('deadline')"
            @save="(text: string) => save({ deadline: normalizeOptional(text) })"
          >
            <template #display>
              <DueDate v-if="shown.deadline" :deadline="shown.deadline" />
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
              :loading="mutations.loading.reopen.value"
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
            :loading="mutations.loading.close.value"
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
            :loading="mutations.loading.link.value"
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
            :loading="mutations.loading.link.value"
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
