/**
 * The pending-edit state machine, without a page around it.
 *
 * What matters here is what the page shows at each moment of a save: the
 * value from the moment it is sent, a wait only once it has been long, and a
 * refusal kept with its edit until the person answers it — and that an answer
 * to an old save never disturbs a newer one.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { SLOW_SAVE_MS, usePendingEdits } from "../../app/composables/usePendingEdits";

interface Edit {
  title: string;
  assignees: string[];
  rank: number | null;
}

const base: Edit = { title: "Old", assignees: ["a@example.com"], rank: null };

/** What Apollo throws for a refusal, shaped as the server sends it. */
function refusal(code: string, message: string, details: string[] = []): unknown {
  return {
    name: "ApolloError",
    message,
    graphQLErrors: [{ message, extensions: { code, details } }],
    networkError: null,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}

describe("usePendingEdits", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the edit from the moment it is sent, and lifts it once it lands", async () => {
    const edits = usePendingEdits<Edit>({ resend: async () => {} });
    const answer = deferred<boolean>();

    const landing = edits.attempt({ assignees: ["b@example.com"] }, () => answer.promise);
    assert.deepEqual(edits.overlay(base).assignees, ["b@example.com"]);
    assert.equal(edits.overlay(base).title, "Old", "other fields are the file's");
    assert.equal(edits.field("assignees").saving, true);
    assert.equal(edits.field("title").saving, false);
    assert.equal(edits.saving.value, true);

    answer.resolve(true);
    assert.equal(await landing, true);
    // The cache holds the new value by now; the overlay is not needed.
    assert.deepEqual(edits.overlay(base), base);
    assert.equal(edits.field("assignees").saving, false);
    assert.equal(edits.saving.value, false);
  });

  it("admits to a slow save only after a while", async () => {
    const edits = usePendingEdits<Edit>({ resend: async () => {} });
    const answer = deferred<boolean>();
    const landing = edits.attempt({ title: "New" }, () => answer.promise);

    vi.advanceTimersByTime(SLOW_SAVE_MS - 1);
    assert.equal(edits.field("title").slow, false, "a fast backend never shows a spinner");
    vi.advanceTimersByTime(1);
    assert.equal(edits.field("title").slow, true);

    answer.resolve(true);
    await landing;
    assert.equal(edits.field("title").slow, false);
  });

  it("never turns slow for a save that has already been answered", async () => {
    const edits = usePendingEdits<Edit>({ resend: async () => {} });
    await edits.attempt({ title: "New" }, async () => true);
    vi.advanceTimersByTime(SLOW_SAVE_MS * 2);
    assert.equal(edits.field("title").slow, false);
  });

  it("keeps a refused edit with the server's words, still shown", async () => {
    const edits = usePendingEdits<Edit>({ resend: async () => {} });
    const landed = await edits.attempt({ assignees: ["b@example.com"] }, async () => {
      throw refusal("SYNC_PUSH_REJECTED", "the remote refused the push", ["origin said no"]);
    });
    assert.equal(landed, false);

    const save = edits.field("assignees");
    assert.equal(save.saving, false);
    assert.deepEqual(save.failure, {
      heading: "The remote refused the push",
      message: "the remote refused the push — origin said no",
    });
    // What was typed is the only copy of itself, so it stays on the page.
    assert.deepEqual(edits.overlay(base).assignees, ["b@example.com"]);
  });

  it("describes a transport failure without a code", async () => {
    const edits = usePendingEdits<Edit>({ resend: async () => {} });
    await edits.attempt({ title: "New" }, async () => {
      throw {
        name: "ApolloError",
        message: "Failed to fetch",
        networkError: { message: "Failed to fetch" },
      };
    });
    assert.deepEqual(edits.field("title").failure, {
      heading: "The server could not be reached",
      message: "Failed to fetch",
    });
  });

  it("sends the kept edit again on retry, through the page's own save", async () => {
    const resent: Partial<Edit>[] = [];
    const edits = usePendingEdits<Edit>({
      resend: async (change) => {
        resent.push(change);
      },
    });
    await edits.attempt({ rank: 20 }, async () => {
      throw refusal("GIT_ERROR", "git commit failed");
    });
    edits.field("rank").retry();
    assert.deepEqual(resent, [{ rank: 20 }]);

    // Nothing to retry once it is settled.
    edits.settle({ rank: 20 });
    edits.field("rank").retry();
    assert.equal(resent.length, 1);
  });

  it("drops the kept edit on discard, so the field shows the file", async () => {
    const edits = usePendingEdits<Edit>({ resend: async () => {} });
    await edits.attempt({ title: "New" }, async () => {
      throw refusal("GIT_ERROR", "git commit failed");
    });
    edits.field("title").discard();
    assert.equal(edits.field("title").failure, null);
    assert.equal(edits.overlay(base).title, "Old");
  });

  it("lifts the overlay when the refusal was handled elsewhere", async () => {
    const edits = usePendingEdits<Edit>({ resend: async () => {} });
    // A stale refusal: `useStaleEdit` has kept it and the page shows theirs.
    const landed = await edits.attempt({ title: "Mine" }, async () => false);
    assert.equal(landed, false);
    assert.equal(edits.overlay(base).title, "Old");
    assert.equal(edits.field("title").failure, null);
  });

  it("lets a newer save of the same field supersede an older one", async () => {
    const edits = usePendingEdits<Edit>({ resend: async () => {} });
    const first = deferred<boolean>();
    const second = deferred<boolean>();

    const one = edits.attempt({ title: "First" }, () => first.promise);
    const two = edits.attempt({ title: "Second" }, () => second.promise);
    assert.equal(edits.overlay(base).title, "Second");

    // The old answer arrives late, and changes nothing.
    first.reject(refusal("GIT_ERROR", "git commit failed"));
    await one;
    assert.equal(edits.overlay(base).title, "Second");
    assert.equal(edits.field("title").failure, null);
    assert.equal(edits.field("title").saving, true);

    second.resolve(true);
    await two;
    assert.equal(edits.overlay(base).title, "Old");
    assert.equal(edits.field("title").saving, false);
  });

  it("keeps one field's refusal while another field saves", async () => {
    const edits = usePendingEdits<Edit>({ resend: async () => {} });
    await edits.attempt({ title: "New" }, async () => {
      throw refusal("GIT_ERROR", "git commit failed");
    });
    await edits.attempt({ rank: 5 }, async () => true);
    assert.equal(edits.field("title").failure?.heading, "A git command failed on the server");
    assert.equal(edits.overlay(base).title, "New");
    assert.equal(edits.field("rank").failure, null);
  });

  it("runs an empty change straight through", async () => {
    const edits = usePendingEdits<Edit>({ resend: async () => {} });
    assert.equal(await edits.attempt({}, async () => true), true);
    assert.equal(edits.saving.value, false);
  });
});
