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

  Everything else about a save is `usePendingEdits`'s, as on the issue page:
  the page renders `shown`, the file with each edit in flight laid over it, so
  a save shows at once; and any refusal but the two above is kept beside the
  field it was about, with a Retry.
-->
<script setup lang="ts">
import { useMutation, useQuery } from "@vue/apollo-composable";
import { ADD_COMMENT, UPDATE_PR } from "~/graphql/mutations";
import {
  FEATURES_QUERY,
  PR_CHANGES_QUERY,
  PR_COMMITS_QUERY,
  PR_QUERY,
  PRS_QUERY,
  REVIEW_POLICY_QUERY,
} from "~/graphql/queries";
import { buildCommentTree, countComments } from "~/utils/comments";
import { distinctValues, newestFirst, shortSha } from "~/utils/entities";
import { describeApiError, unservedBranch } from "~/utils/errors";
import { buildEntityPatch, type EntityEdit, fieldLabel, PatchError } from "~/utils/patch";
import { entityTitle } from "~/utils/title";
import type { Verdict } from "~~/src/generated/gql/graphql";

const route = useRoute();
const router = useRouter();
const toast = useToast();
const commitToast = useCommitToast();

const reference = computed(() => String(route.params.ref ?? ""));

/*
 * Three tabs, as every forge has them: the conversation, the commits the
 * branch brings, and what they change. The tab is in the address, as the
 * listing's filters are, so a link to the changes opens on the changes and
 * the back button returns to where somebody was; `replace`, not `push`, so
 * switching tabs does not pile history entries up (`useEntityFilter`).
 *
 * The conversation is the default and carries no parameter, so an address
 * that predates the tabs still means what it did.
 */
type Tab = "conversation" | "commits" | "changes";
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "conversation", label: "Conversation", icon: "i-lucide-message-square" },
  { key: "commits", label: "Commits", icon: "i-lucide-git-commit-horizontal" },
  { key: "changes", label: "Changes", icon: "i-lucide-file-diff" },
];
const tab = computed<Tab>({
  get: () =>
    route.query.tab === "commits" || route.query.tab === "changes"
      ? route.query.tab
      : "conversation",
  set: (value) => {
    const { tab: _tab, ...rest } = route.query;
    void router.replace({ query: value === "conversation" ? rest : { ...rest, tab: value } });
  },
});

/*
 * Each of the two extra tabs is its own query, sent the first time its tab
 * is opened and not before: the page must open as fast as it did with one
 * tab, and a diff is the one thing on it that can be large. `cache-first`,
 * because both are functions of the revision's two SHAs, which do not change
 * under a page — a new revision is a new pull request read, and a reload.
 */
const COMMIT_LIMIT = 250;
const {
  result: commitsResult,
  loading: commitsLoading,
  error: commitsError,
  refetch: refetchCommits,
} = useQuery(
  PR_COMMITS_QUERY,
  () => ({ ref: reference.value, limit: COMMIT_LIMIT }),
  () => ({ enabled: tab.value === "commits", fetchPolicy: "cache-first" }),
);
const commits = computed(() => commitsResult.value?.pr.commits ?? null);

const {
  result: changesResult,
  loading: changesLoading,
  error: changesError,
  refetch: refetchChanges,
} = useQuery(
  PR_CHANGES_QUERY,
  () => ({ ref: reference.value }),
  () => ({ enabled: tab.value === "changes", fetchPolicy: "cache-first" }),
);
const changes = computed(() => changesResult.value?.pr.changes ?? null);

/** What each tab's button says beside its name, once the tab has been read. */
const tabCount = (key: Tab): number | null => {
  if (key === "commits") return commits.value?.total ?? null;
  if (key === "changes") return changes.value?.files.length ?? null;
  return null;
};

const { result, loading, error, refetch } = useQuery(PR_QUERY, () => ({ ref: reference.value }), {
  fetchPolicy: "cache-and-network",
});
const pr = computed(() => result.value?.pr ?? null);

// As on the issue page: the reference is known from the address, the title
// when the query answers.
useHead({
  title: computed(() =>
    pr.value === null ? entityTitle(reference.value) : entityTitle(pr.value.id, pr.value.title),
  ),
});

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

// Every failure is the page's own to report, so the shared toast stays quiet.
const { mutate: patch, loading: patching } = useMutation(UPDATE_PR, {
  context: { handled: true },
});
const staleEdits = useStaleEdit({ refetch, resend: (change) => save(change) });
const edits = usePendingEdits<EntityEdit>({
  resend: (change) => save(change),
  // A refusal that arrives after leaving the page has no field to sit under.
  lost: (failure) =>
    toast.add({ title: failure.heading, description: failure.message, color: "error" }),
});
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

/** The pull request as the page shows it: the file, with every edit in flight over it. */
const shown = computed(() => edits.overlay(current.value));

/**
 * The reviewer states as they will read once a pending save lands.
 *
 * `reviews` is derived on the server from `reviewer:` and the reviews given
 * (`packages/core`'s `reviewSummary`), so a reviewer just asked has no row
 * until the answer comes back. Only the difference a pending edit makes is
 * applied here: somebody newly asked is shown pending, and somebody just
 * taken off the list loses their pending row — never a verdict, which stands
 * whether they were asked or not. With no edit out, this is the server's list
 * untouched, rules and all.
 */
const reviewsShown = computed(() => {
  const reviews = pr.value?.reviews ?? [];
  const before = new Set(current.value.reviewers ?? []);
  const after = new Set(shown.value.reviewers ?? []);
  const removed = new Set([...before].filter((person) => !after.has(person)));
  const added = [...after].filter((person) => !before.has(person));
  const named = new Set(reviews.map((review) => review.person));
  return [
    ...reviews.filter((review) => review.state !== "PENDING" || !removed.has(review.person)),
    ...added
      .filter((person) => !named.has(person))
      .map((person) => ({ person, state: "PENDING" as const, volunteer: false, comment: null })),
  ];
});

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
    // Against what the file is about to say, as on the issue page.
    built = buildEntityPatch(edits.basis(current.value), change);
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
    edits.settle(change);
    return;
  }

  const { id, baseSha } = pr.value;
  // Three things a refusal can be. Stale: kept by `staleEdits`, beside what
  // the file says now. Not from here: the branch is named beside the form and
  // every editor withdraws, so the edit is let go. Anything else: kept by
  // `edits`, beside the value it tried to set, with a Retry.
  await edits.attempt(change, () =>
    staleEdits.attempt(change, async () => {
      try {
        const written = await patch({ input: { ref: id, ...built, baseSha } });
        const payload = written?.data?.updatePr;
        if (!payload) return false;
        commitToast.report(payload.commit, wroteOf(change));
        refreshListings();
        refusedOn.value = null;
        return true;
      } catch (failure) {
        const branch = unservedBranch(describeApiError(failure));
        if (branch === null) throw failure;
        refusedOn.value = branch;
        return false;
      }
    }),
  );
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
          :value="shown.title"
          label="title"
          testid="title"
          required
          :save="edits.field('title')"
          :disabled="branchHint !== null"
          @save="(title: string) => save({ title })"
        >
          <h1 class="text-2xl font-semibold" data-testid="pr-title">{{ shown.title }}</h1>
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

      <nav class="flex items-center gap-1 border-b border-default" aria-label="Pull request sections" data-testid="pr-tabs">
        <UButton
          v-for="item in TABS"
          :key="item.key"
          :icon="item.icon"
          color="neutral"
          :variant="tab === item.key ? 'soft' : 'ghost'"
          size="sm"
          class="rounded-b-none"
          :aria-current="tab === item.key ? 'page' : undefined"
          :data-testid="`pr-tab-${item.key}`"
          @click="tab = item.key"
        >
          {{ item.label }}
          <UBadge v-if="tabCount(item.key) !== null" color="neutral" variant="subtle" size="sm">
            {{ tabCount(item.key) }}
          </UBadge>
        </UButton>
      </nav>

      <QueryState
        v-if="tab === 'commits'"
        :loading="commitsLoading && commits === null"
        :error="commitsError"
        :skeleton-rows="4"
        @retry="refetchCommits()"
      >
        <CommitTable v-if="commits" :commits="commits.commits" :total="commits.total" />
      </QueryState>

      <QueryState
        v-else-if="tab === 'changes'"
        :loading="changesLoading && changes === null"
        :error="changesError"
        :skeleton-rows="6"
        @retry="refetchChanges()"
      >
        <DiffView v-if="changes" :pr-ref="pr.id" :changes="changes" />
      </QueryState>

      <div v-else class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div class="space-y-6">
          <EditableText
            :value="shown.body"
            label="description"
            testid="body"
            multiline
            required
            :save="edits.field('body')"
            :disabled="branchHint !== null"
            @save="(body: string) => save({ body })"
          >
            <MarkdownBody :source="shown.body" />
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
            :values="shown.reviewers ?? []"
            :suggestions="people"
            :save="edits.field('reviewers')"
            :disabled="branchHint !== null"
            @save="(reviewers: string[]) => save({ reviewers })"
          >
            <template #display>
              <ReviewList :reviews="reviewsShown" />
              <ReviewPolicyNote :policy="reviewPolicy" class="mt-2" />
            </template>
          </LabelEditor>

          <LabelEditor
            title="Labels"
            icon="i-lucide-tag"
            testid="labels"
            :values="shown.labels"
            :suggestions="known.labels"
            :save="edits.field('labels')"
            :disabled="branchHint !== null"
            @save="(labels: string[]) => save({ labels })"
          />
          <LabelEditor
            title="Assignees"
            icon="i-lucide-user"
            testid="assignees"
            :values="shown.assignees"
            :suggestions="people"
            :save="edits.field('assignees')"
            :disabled="branchHint !== null"
            @save="(assignees: string[]) => save({ assignees })"
          >
            <!--
              Kept as the avatars this page already showed rather than the
              default chips: the display slot suppresses the component's own
              "None", so the empty case has to be said here too.
            -->
            <template #display>
              <div v-if="shown.assignees.length" class="space-y-1 text-sm">
                <PersonLabel v-for="who in shown.assignees" :key="who" :person="who" avatar />
              </div>
              <p v-else class="text-sm text-muted">None</p>
            </template>
          </LabelEditor>
          <LabelEditor
            title="Features"
            icon="i-lucide-layers"
            testid="features"
            link-to="/features/"
            :values="shown.features"
            :suggestions="known.features"
            :save="edits.field('features')"
            :disabled="branchHint !== null"
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
            :disabled="branchHint !== null"
            @save="(values: string[]) => save({ milestone: values[0] ?? null })"
          />

          <p class="break-all border-t border-default pt-4 text-xs text-muted">{{ pr.path }}</p>
        </aside>
      </div>
    </article>
  </QueryState>
</template>
