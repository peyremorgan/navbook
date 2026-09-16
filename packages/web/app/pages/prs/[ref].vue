<!--
  One pull request: what it proposes, which revisions it has had, and the
  review it has attracted.

  Opening a pull request, appending a revision to one and merging it are
  checkout-centric — they need a branch, a working tree and a merge — and the
  API deliberately does not expose them, so neither does this. Its metadata is
  another matter: every field `updatePr` takes is a patch to one file, and is
  edited here exactly as an issue's is. Only `rank` and `deadline` are missing
  from the sidebar, because they are an issue's alone (spec 02 §2.5).

  The refusal worth designing for is `PRECONDITION`. A pull request's files
  live on the branch it proposes to merge, so `allRefs` can find one this
  server does not have checked out: it can be read, and it can be written to by
  nobody. The alert says which branch to serve instead, because that is the
  actual remedy and nothing this client does can substitute for it.

  The other refusal is `STALE_CONTENT`, and it is `useStaleEdit`'s, as on the
  issue page: every save names the version it was edited from, a field somebody
  else changed since is refused, and the refused edit is kept beside what the
  page now says until the person decides between them.
-->
<script setup lang="ts">
import { useMutation, useQuery } from "@vue/apollo-composable";
import { ADD_COMMENT, UPDATE_PR } from "~/graphql/mutations";
import { FEATURES_QUERY, PR_QUERY, PRS_QUERY, REVIEW_POLICY_QUERY } from "~/graphql/queries";
import { buildCommentTree, countComments } from "~/utils/comments";
import { distinctValues, newestFirst, shortSha } from "~/utils/entities";
import { describeApiError, unservedBranch } from "~/utils/errors";
import { buildEntityPatch, type EntityEdit, fieldLabel, PatchError } from "~/utils/patch";
import type { Verdict } from "~~/src/generated/gql/graphql";

const route = useRoute();
const toast = useToast();
const commitToast = useCommitToast();

const reference = computed(() => String(route.params.ref ?? ""));

const { result, loading, error, refetch } = useQuery(PR_QUERY, () => ({ ref: reference.value }), {
  fetchPolicy: "cache-and-network",
});
const pr = computed(() => result.value?.pr ?? null);

// A property of the repository rather than of this pull request, so it is its
// own query: it explains the decision beside it, and a page that failed to
// read it should still show everything else (spec 02 §2.10).
const { result: policyResult } = useQuery(REVIEW_POLICY_QUERY);
const reviewPolicy = computed(() => policyResult.value?.reviewPolicy ?? null);

// Asking somebody to review means naming somebody who is not on the list yet,
// which is precisely what offering only the people already asked cannot help
// with. The repository knows who is around; this asks it.
const people = usePeople();

/*
 * Suggestions for the sidebar's menus, exactly as the issue page gets them.
 *
 * Labels and milestones have no registry to read — the format keeps none — so
 * a listing is fetched purely to have something to offer, and being incomplete
 * costs nothing because every menu takes a value that is not in it. Features
 * are real directories, so their list is the registry itself.
 *
 * The listing is the served checkout's, not `allRefs`: this is a menu, and the
 * cheaper answer is the right one for a menu. It is also the same cache entry
 * the listing page fills, so the common path asks for nothing new.
 */
const { result: listing } = useQuery(
  PRS_QUERY,
  { filter: {}, allRefs: false },
  { fetchPolicy: "cache-first" },
);
const { result: featureList } = useQuery(FEATURES_QUERY, undefined, {
  fetchPolicy: "cache-first",
});
const known = computed(() => {
  const prs = listing.value?.prs ?? [];
  return {
    labels: distinctValues(prs, (item) => item.labels),
    milestones: distinctValues(prs, (item) => (item.milestone ? [item.milestone] : [])),
    features: (featureList.value?.features ?? []).map((feature) => feature.slug),
  };
});

const comments = computed(() => buildCommentTree(pr.value?.comments ?? []));
const commentCount = computed(() => countComments(comments.value));

/** Newest first for reading; the file's own order is the reverse (spec 02 §2.7). */
const revisions = computed(() => newestFirst(pr.value?.revisions ?? []));

const replyTo = ref<string | null>(null);
const replyToAuthor = computed(
  () => pr.value?.comments.find((item) => item.id === replyTo.value)?.author ?? null,
);

/** The branch to serve, once the server has told us it is not this one. */
const refusedOn = ref<string | null>(null);
const reviewForm = useTemplateRef<{ clear: () => void }>("reviewForm");

// The refusal is handled here, beside the form, rather than in the shared toast.
const { mutate, loading: saving } = useMutation(ADD_COMMENT, {
  context: { handledCodes: ["PRECONDITION"] },
});

async function submit(input: {
  body: string;
  verdict: Verdict | null;
  revision: string | null;
  file: string | null;
  line: string | null;
}): Promise<void> {
  if (pr.value === null) return;
  try {
    const written = await mutate({
      input: {
        kind: "PR",
        ref: pr.value.id,
        body: input.body,
        ...(replyTo.value === null ? {} : { replyTo: replyTo.value }),
        ...(input.verdict === null ? {} : { verdict: input.verdict }),
        ...(input.revision === null ? {} : { revision: input.revision }),
        ...(input.file === null ? {} : { file: input.file }),
        ...(input.line === null ? {} : { line: input.line }),
      },
    });
    const payload = written?.data?.addComment;
    if (payload) {
      commitToast.report(payload.commit, input.verdict === null ? "Commented" : "Review recorded");
      // Only on success: a refusal must leave the review where it was written.
      reviewForm.value?.clear();
      replyTo.value = null;
      refusedOn.value = null;
    }
  } catch (failure) {
    const described = describeApiError(failure);
    const branch = unservedBranch(described);
    if (branch === null) {
      toast.add({ title: "Could not comment", description: described.message, color: "error" });
      return;
    }
    refusedOn.value = branch;
  }
}

/* ----------------------------------------------------------------- metadata */

const { mutate: patch, loading: patching } = useMutation(UPDATE_PR, {
  context: { handledCodes: ["PRECONDITION", "STALE_CONTENT"] },
});
const staleEdits = useStaleEdit({ refetch, resend: (change) => save(change) });
// Asking somebody new to review is how they become somebody the repository
// knows of, and the answer that listed everybody was fetched before they were.
const refreshListings = useListingRefresh();

/** The pull request as the patch builder compares against. */
const current = computed<EntityEdit>(() => ({
  title: pr.value?.title ?? "",
  body: pr.value?.body ?? "",
  labels: [...(pr.value?.labels ?? [])],
  assignees: [...(pr.value?.assignees ?? [])],
  milestone: pr.value?.milestone ?? null,
  features: [...(pr.value?.features ?? [])],
  reviewers: [...(pr.value?.reviewers ?? [])],
}));

/** What the toast calls a save of these fields: "Title updated". */
function wroteOf(change: Partial<EntityEdit>): string {
  const [first] = Object.keys(change);
  const label = fieldLabel(first ?? "field");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} updated`;
}

/**
 * Patch one field, and say which one was written.
 *
 * `rank` and `deadline` are absent because they are an issue's alone (spec 02
 * §2.5); everything else `UpdatePrInput` takes is here. One field at a time
 * for the reason the issue page gives: the mutation tells an absent key from
 * an explicit null, so sending the whole form would rewrite frontmatter nobody
 * touched.
 */
async function save(change: Partial<EntityEdit>): Promise<void> {
  if (pr.value === null) return;

  let built: ReturnType<typeof buildEntityPatch>;
  try {
    built = buildEntityPatch(current.value, change);
  } catch (failure) {
    if (!(failure instanceof PatchError)) throw failure;
    toast.add({ title: "That will not do", description: failure.message, color: "error" });
    return;
  }
  // Nothing moved, so there is nothing to send: the server refuses an empty
  // patch, and this is also what a closed editor should do. It does settle a
  // refused edit of the same field: the page already says what was typed.
  if (built === null) {
    staleEdits.settle(change);
    return;
  }

  const { id, baseSha } = pr.value;
  try {
    await staleEdits.attempt(change, async () => {
      const written = await patch({ input: { ref: id, ...built, baseSha } });
      const payload = written?.data?.updatePr;
      if (!payload) return false;
      commitToast.report(payload.commit, wroteOf(change));
      refreshListings();
      refusedOn.value = null;
      return true;
    });
  } catch (failure) {
    const described = describeApiError(failure);
    const branch = unservedBranch(described);
    if (branch === null) {
      toast.add({ title: "Could not save", description: described.message, color: "error" });
      return;
    }
    refusedOn.value = branch;
  }
}

/**
 * Whether commenting is possible at all.
 *
 * `refs` is empty for a pull request read out of the working tree and holds
 * the branches the cross-ref scan found it on otherwise — so a non-empty
 * `refs` that does not include the checkout is the hint that a comment will be
 * refused. It is only a hint: the server decides, and its refusal is what sets
 * `refusedOn`. Showing the form and letting it fail once is better than
 * guessing wrong and hiding it from somebody who could have used it.
 */
const branchHint = computed(() => refusedOn.value);
</script>

<template>
  <QueryState :loading="loading && pr === null" :error="error" :skeleton-rows="5" @retry="refetch()">
    <article v-if="pr" class="space-y-6" data-testid="pr-detail">
      <header class="space-y-2">
        <EditableText
          :value="pr.title"
          label="title"
          testid="title"
          required
          :saving="patching"
          :disabled="branchHint !== null"
          @save="(title: string) => save({ title })"
        >
          <h1 class="text-2xl font-semibold" data-testid="pr-title">{{ pr.title }}</h1>
        </EditableText>
        <div class="flex flex-wrap items-center gap-2 text-sm text-muted">
          <StatusBadge :status="pr.status" :draft="pr.draft" />
          <code data-testid="pr-id">#{{ pr.id }}</code>
          <span class="inline-flex items-center gap-1">
            <UIcon name="i-lucide-git-merge" class="size-3.5" />
            <code>{{ pr.source ?? "an unrecorded branch" }}</code> →
            <code data-testid="pr-target">{{ pr.target }}</code>
          </span>
          <span>opened <TimeAgo :iso="pr.created" /> by <PersonLabel :person="pr.author" /></span>
          <span>· {{ commentCount }} comment{{ commentCount === 1 ? "" : "s" }}</span>
          <ReviewBadge
            :decision="pr.reviewDecision"
            :asked="pr.reviewers.length > 0"
            :approvals="pr.approvals"
          />
        </div>
        <div v-if="pr.refs.length" class="flex flex-wrap items-center gap-1 text-xs text-muted">
          <UIcon name="i-lucide-git-branch" class="size-3" />
          <span>found on</span>
          <code v-for="branch in pr.refs" :key="branch" data-testid="pr-ref">{{ branch }}</code>
        </div>
      </header>

      <StaleEditAlert
        v-if="staleEdits.stale.value"
        :message="staleEdits.stale.value.message"
        :change="staleEdits.stale.value.change"
        :saving="patching || staleEdits.refetching.value"
        @reapply="staleEdits.reapply"
        @dismiss="staleEdits.dismiss"
      />

      <UAlert
        v-if="pr.merged"
        color="primary"
        variant="subtle"
        icon="i-lucide-git-merge"
        title="Merged"
        data-testid="merged-banner"
      >
        <template #description>
          <span v-if="pr.merged.by">By {{ pr.merged.by }}</span>
          <span v-if="pr.merged.date"> on {{ pr.merged.date }}</span>
          <span v-if="pr.merged.commit"> as <code>{{ shortSha(pr.merged.commit) }}</code></span>
        </template>
      </UAlert>

      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div class="space-y-6">
          <EditableText
            :value="pr.body"
            label="description"
            testid="body"
            multiline
            required
            :saving="patching"
            :disabled="branchHint !== null"
            @save="(body: string) => save({ body })"
          >
            <MarkdownBody :source="pr.body" />
          </EditableText>

          <section class="space-y-3">
            <h2 class="font-semibold">Discussion</h2>
            <div v-if="comments.length" class="space-y-3" data-testid="pr-comment-thread">
              <CommentCard
                v-for="node in comments"
                :key="node.comment.id"
                :node="node"
                @reply="(id: string) => (replyTo = id)"
              />
            </div>
            <p v-else class="text-sm text-muted">No comments yet.</p>

            <ReviewForm
              ref="reviewForm"
              :revisions="pr.revisions"
              :reply-to="replyTo"
              :reply-to-author="replyToAuthor"
              :saving="saving"
              :unserved-branch="branchHint"
              @submit="submit"
              @cancel-reply="replyTo = null"
            />
          </section>
        </div>

        <aside class="space-y-5 lg:border-s lg:border-default lg:ps-6">
          <section class="space-y-1.5">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">Revisions</h3>
            <ol class="space-y-1 text-sm" data-testid="revisions">
              <li
                v-for="(revision, index) in revisions"
                :key="revision.head"
                class="flex flex-wrap items-baseline gap-x-2"
              >
                <code :title="revision.head">{{ shortSha(revision.head) }}</code>
                <UBadge v-if="index === 0" color="primary" variant="subtle" size="sm">latest</UBadge>
                <span class="text-xs text-muted">
                  on <code :title="revision.base">{{ shortSha(revision.base) }}</code>,
                  <TimeAgo :iso="revision.date" />
                </span>
              </li>
            </ol>
            <p v-if="!revisions.length" class="text-sm text-muted">None recorded.</p>
          </section>

          <!--
            Who was asked, and what each of them said about the latest revision.
            The list edits `reviewer:`; the states beside it are derived and are
            not what a save sends back (spec 02 §2.7).
          -->
          <LabelEditor
            title="Reviewers"
            icon="i-lucide-eye"
            testid="reviewers"
            :values="pr.reviewers"
            :suggestions="people"
            :saving="patching"
            :disabled="branchHint !== null"
            @save="(reviewers: string[]) => save({ reviewers })"
          >
            <template #display>
              <ReviewList :reviews="pr.reviews" />
              <ReviewPolicyNote :policy="reviewPolicy" class="mt-2" />
            </template>
          </LabelEditor>

          <LabelEditor
            title="Labels"
            icon="i-lucide-tag"
            testid="labels"
            :values="pr.labels"
            :suggestions="known.labels"
            :saving="patching"
            :disabled="branchHint !== null"
            @save="(labels: string[]) => save({ labels })"
          />
          <LabelEditor
            title="Assignees"
            icon="i-lucide-user"
            testid="assignees"
            :values="pr.assignees"
            :suggestions="people"
            :saving="patching"
            :disabled="branchHint !== null"
            @save="(assignees: string[]) => save({ assignees })"
          >
            <!--
              Kept as the avatars this page already showed rather than the
              default chips: the display slot suppresses the component's own
              "None", so the empty case has to be said here too.
            -->
            <template #display>
              <div v-if="pr.assignees.length" class="space-y-1 text-sm">
                <PersonLabel v-for="who in pr.assignees" :key="who" :person="who" avatar />
              </div>
              <p v-else class="text-sm text-muted">None</p>
            </template>
          </LabelEditor>
          <LabelEditor
            title="Features"
            icon="i-lucide-layers"
            testid="features"
            link-to="/features/"
            :values="pr.features"
            :suggestions="known.features"
            :saving="patching"
            :disabled="branchHint !== null"
            @save="(features: string[]) => save({ features })"
          />
          <LabelEditor
            title="Milestone"
            icon="i-lucide-flag"
            testid="milestone"
            single
            :values="pr.milestone ? [pr.milestone] : []"
            :suggestions="known.milestones"
            :saving="patching"
            :disabled="branchHint !== null"
            @save="(values: string[]) => save({ milestone: values[0] ?? null })"
          />

          <p class="break-all border-t border-default pt-4 text-xs text-muted">{{ pr.path }}</p>
        </aside>
      </div>
    </article>
  </QueryState>
</template>
