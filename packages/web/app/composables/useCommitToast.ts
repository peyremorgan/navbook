/**
 * Saying what a mutation actually did.
 *
 * Every write returns `commit { committed subject pushed }`, and every part of
 * that is worth reporting. `committed: false` means the operation turned out to
 * change nothing, which is a surprise worth naming rather than a silent
 * success. `pushed: false` means the change exists in the server's clone and
 * nowhere else — it is not in anybody's `git pull`, and it will not be until
 * an operator looks at the clone.
 *
 * Hiding that would be the one thing this client must not do. The server's
 * whole arrangement is that git is the only durable state and conflicts
 * surface rather than being resolved on somebody's behalf (spec 06 §6.3); a UI
 * that reported "Saved" either way would be quietly lying about where the work
 * went.
 */

export interface CommitInfoLike {
  committed: boolean;
  subject: string;
  pushed: boolean;
}

export interface CommitToast {
  /** Report what a mutation committed, and whether it reached the remote. */
  report(commit: CommitInfoLike | null | undefined, done: string): void;
}

export function useCommitToast(): CommitToast {
  const toast = useToast();

  return {
    report(commit, done) {
      if (!commit) return;

      if (!commit.committed) {
        toast.add({
          title: "Nothing changed",
          description: "The server had nothing to record; the tree already said this.",
          color: "neutral",
          icon: "i-lucide-info",
        });
        return;
      }

      if (!commit.pushed) {
        toast.add({
          title: `${done}, but not pushed`,
          description: `Committed to the server's clone as “${commit.subject}”. It is not on the remote, so nobody else can pull it yet.`,
          color: "warning",
          icon: "i-lucide-cloud-off",
          duration: 10000,
        });
        return;
      }

      toast.add({
        title: done,
        description: commit.subject,
        color: "success",
        icon: "i-lucide-check",
      });
    },
  };
}
