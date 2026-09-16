/**
 * The refused-edit state machine, without a page around it.
 *
 * What matters here is what the kept edit survives: another field's save must
 * not discard it, a save of its own field must, and a reapply must wait for the
 * page to have been read again.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { useStaleEdit } from "../../app/composables/useStaleEdit";

/** What Apollo throws for a stale refusal, shaped as the server sends it. */
function refusal(message: string, moved: string[]): unknown {
  return {
    name: "ApolloError",
    message,
    graphQLErrors: [{ message, extensions: { code: "STALE_CONTENT", moved } }],
    networkError: null,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("useStaleEdit", () => {
  it("keeps a refused edit and reads the page again", async () => {
    let refetched = 0;
    const edits = useStaleEdit({
      refetch: async () => {
        refetched += 1;
      },
      resend: async () => {},
    });

    const landed = await edits.attempt({ title: "Mine" }, async () => {
      throw refusal("title of #aaaa0001 changed since you opened it", ["title"]);
    });
    assert.equal(landed, false);
    assert.equal(refetched, 1);
    assert.deepEqual(edits.stale.value, {
      change: { title: "Mine" },
      message: "title of #aaaa0001 changed since you opened it",
      moved: ["title"],
    });
    assert.equal(edits.refetching.value, false);
  });

  it("lets any other failure through untouched", async () => {
    const edits = useStaleEdit({ refetch: async () => {}, resend: async () => {} });
    const boom = new Error("boom");
    await assert.rejects(
      edits.attempt({ title: "Mine" }, async () => {
        throw boom;
      }),
      (error) => error === boom,
    );
    assert.equal(edits.stale.value, null);
  });

  it("survives a save of another field, and is settled by one of its own", async () => {
    const edits = useStaleEdit({ refetch: async () => {}, resend: async () => {} });
    await edits.attempt({ title: "Mine" }, async () => {
      throw refusal("title changed", ["title"]);
    });

    // Setting a label while deciding is no answer to the question.
    assert.equal(await edits.attempt({ labels: ["bug"] }, async () => true), true);
    assert.notEqual(edits.stale.value, null);
    // Nor is a save that failed for some other, already-reported reason.
    assert.equal(await edits.attempt({ title: "Again" }, async () => false), false);
    assert.notEqual(edits.stale.value, null);

    // A title save that lands is.
    await edits.attempt({ title: "Again" }, async () => true);
    assert.equal(edits.stale.value, null);
  });

  it("is settled by a save of its field that turned out to change nothing", async () => {
    const edits = useStaleEdit({ refetch: async () => {}, resend: async () => {} });
    await edits.attempt({ body: "Mine." }, async () => {
      throw refusal("body changed", ["body"]);
    });
    edits.settle({ labels: [] });
    assert.notEqual(edits.stale.value, null);
    edits.settle({ body: "Mine." });
    assert.equal(edits.stale.value, null);
  });

  it("reapplies through the caller, but not before the page has been read again", async () => {
    const reading = deferred<void>();
    const resent: unknown[] = [];
    const edits = useStaleEdit({
      refetch: () => reading.promise,
      resend: async (change) => {
        resent.push(change);
      },
    });

    const attempt = edits.attempt({ title: "Mine" }, async () => {
      throw refusal("title changed", ["title"]);
    });
    // The alert is up and the refetch is still out.
    await Promise.resolve();
    assert.equal(edits.refetching.value, true);
    await edits.reapply();
    assert.deepEqual(resent, []);

    reading.resolve();
    await attempt;
    assert.equal(edits.refetching.value, false);
    await edits.reapply();
    assert.deepEqual(resent, [{ title: "Mine" }]);
  });

  it("keeps the alert up when the refetch itself fails", async () => {
    const edits = useStaleEdit({
      refetch: async () => {
        throw new Error("offline");
      },
      resend: async () => {},
    });
    await edits.attempt({ title: "Mine" }, async () => {
      throw refusal("title changed", ["title"]);
    });
    assert.notEqual(edits.stale.value, null);
    assert.equal(edits.refetching.value, false);
  });

  it("forgets the edit when dismissed", async () => {
    const edits = useStaleEdit({ refetch: async () => {}, resend: async () => {} });
    await edits.attempt({ title: "Mine" }, async () => {
      throw refusal("title changed", ["title"]);
    });
    edits.dismiss();
    assert.equal(edits.stale.value, null);
    await edits.reapply();
  });
});
