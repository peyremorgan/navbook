<!--
  One pull request: what it proposes, which revisions it has had, and the
  review it has attracted.

  Read-only apart from commenting. Opening, updating and merging a pull request
  are checkout-centric — they need a branch, a working tree and a merge — and
  the API deliberately does not expose them, so neither does this.

  The refusal worth designing for is `PRECONDITION`. A pull request's files
  live on the branch it proposes to merge, so `allRefs` can find one this
  server does not have checked out: it can be read, and it cannot be commented
  on. The alert says which branch to serve instead, because that is the actual
  remedy and nothing this client does can substitute for it.
-->
<script setup lang="ts">
import { useMutation, useQuery } from "@vue/apollo-composable";
import { ADD_COMMENT } from "~/graphql/mutations";
import { PR_QUERY } from "~/graphql/queries";
import { buildCommentTree, countComments } from "~/utils/comments";
import { shortSha } from "~/utils/entities";
import { describeApiError, unservedBranch } from "~/utils/errors";
import type { Verdict } from "~~/src/generated/gql/graphql";

const route = useRoute();
const toast = useToast();
const commitToast = useCommitToast();

const reference = computed(() => String(route.params.ref ?? ""));

const { result, loading, error, refetch } = useQuery(PR_QUERY, () => ({ ref: reference.value }), {
  fetchPolicy: "cache-and-network",
});
const pr = computed(() => result.value?.pr ?? null);

const comments = computed(() => buildCommentTree(pr.value?.comments ?? []));
const commentCount = computed(() => countComments(comments.value));

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
        <h1 class="text-2xl font-semibold" data-testid="pr-title">{{ pr.title }}</h1>
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
        </div>
        <div v-if="pr.refs.length" class="flex flex-wrap items-center gap-1 text-xs text-muted">
          <UIcon name="i-lucide-git-branch" class="size-3" />
          <span>found on</span>
          <code v-for="branch in pr.refs" :key="branch" data-testid="pr-ref">{{ branch }}</code>
        </div>
      </header>

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
          <MarkdownBody :source="pr.body" />

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
                v-for="(revision, index) in pr.revisions"
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
            <p v-if="!pr.revisions.length" class="text-sm text-muted">None recorded.</p>
          </section>

          <section v-if="pr.labels.length" class="space-y-1.5">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">Labels</h3>
            <div class="flex flex-wrap gap-1">
              <UBadge v-for="label in pr.labels" :key="label" color="neutral" variant="subtle" size="sm">
                {{ label }}
              </UBadge>
            </div>
          </section>

          <section v-if="pr.assignees.length" class="space-y-1.5">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">Assignees</h3>
            <div class="space-y-1 text-sm">
              <PersonLabel v-for="who in pr.assignees" :key="who" :person="who" avatar />
            </div>
          </section>

          <section v-if="pr.milestone" class="space-y-1.5">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">Milestone</h3>
            <p class="text-sm">{{ pr.milestone }}</p>
          </section>

          <p class="break-all border-t border-default pt-4 text-xs text-muted">{{ pr.path }}</p>
        </aside>
      </div>
    </article>
  </QueryState>
</template>
