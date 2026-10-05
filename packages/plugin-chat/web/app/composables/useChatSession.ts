/**
 * The conversation, for as long as the page is open.
 *
 * Module state rather than a component's, so it survives the panel being
 * closed and the person moving from page to page; a reload starts afresh, as
 * nothing is kept anywhere else. Each turn is one `chat` subscription, read as
 * server-sent events over a plain `fetch`: Apollo's HTTP link does not stream,
 * and nothing here needs more than one request per turn.
 */

import { print } from "graphql";
import { parseSseEvents } from "../../../src/shared/sse";
import { CHAT_SUBSCRIPTION } from "../graphql/queries";
import {
  applyEvent,
  type ChatEventWire,
  type ChatState,
  decide as decideOne,
  emptyChat,
  interrupt,
  reset as resetChat,
  startTurn,
  type ToolPart,
  takeDecisions,
} from "../utils/chat-state";

export type ChatMode = "manual" | "allow-all";

const state = reactive<ChatState>(emptyChat());
const open = ref(false);
const mode = ref<ChatMode>("manual");
let inflight: AbortController | null = null;

export function useChatSession() {
  // Everything that needs the Nuxt app is taken now, in setup: after an
  // `await` there is no app to ask.
  const auth = useAuth();
  const { $navConfig, $apollo } = useNuxtApp();
  const refresh = useListingRefresh();
  const commits = useCommitToast();

  /** Something the assistant wrote: refresh what the page shows, and say so. */
  function landed(part: ToolPart): void {
    refresh();
    // A record open on the page reads again too, rather than showing what it was.
    for (const fieldName of ["issue", "pr"]) $apollo.cache.evict({ id: "ROOT_QUERY", fieldName });
    $apollo.cache.gc();
    if (part.commit)
      commits.report(part.commit, part.summary.charAt(0).toUpperCase() + part.summary.slice(1));
  }

  async function run(input: {
    message?: string;
    approvals?: { callId: string; approved: boolean }[];
  }): Promise<void> {
    const controller = new AbortController();
    inflight = controller;
    let finished = false;
    try {
      const token = await auth.getAccessToken();
      if (token === null) {
        await auth.login();
        return;
      }
      const response = await fetch($navConfig.graphqlUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query: print(CHAT_SUBSCRIPTION),
          variables: {
            input: {
              transcript: state.transcript,
              ...(input.message === undefined ? {} : { message: input.message }),
              ...(input.approvals ? { approvals: input.approvals } : {}),
              autoApprove: mode.value === "allow-all",
            },
          },
        }),
        signal: controller.signal,
      });
      if (response.status === 401) {
        interrupt(state, "Your session has ended; signing in again.");
        await auth.forget();
        await auth.login();
        return;
      }
      if (!response.ok || response.body === null) {
        interrupt(state, `The server answered ${response.status}.`);
        return;
      }
      for await (const sse of parseSseEvents(response.body)) {
        if (sse.event === "complete") break;
        if (sse.event !== "next") continue;
        const payload = JSON.parse(sse.data) as {
          data?: { chat?: ChatEventWire } | null;
          errors?: { message: string }[];
        };
        const event = payload.data?.chat;
        if (!event) {
          interrupt(state, payload.errors?.[0]?.message ?? "The server sent something unexpected.");
          finished = true;
          break;
        }
        const wrote = applyEvent(state, event);
        if (wrote) landed(wrote);
        if (event.type === "DONE" || event.type === "ERROR") finished = true;
      }
      if (!finished) interrupt(state, "The connection closed before the reply was finished.");
    } catch (error) {
      if (controller.signal.aborted) interrupt(state, null);
      else interrupt(state, error instanceof Error ? error.message : String(error));
    } finally {
      if (inflight === controller) inflight = null;
    }
  }

  return {
    state: readonly(state),
    open,
    mode,
    busy: computed(() => state.status === "submitted" || state.status === "streaming"),

    async send(text: string): Promise<void> {
      const message = text.trim();
      if (message === "" || inflight !== null) return;
      // Saying something new over writes still waiting declines those not
      // yet approved; the ones already approved go ahead. The server settles
      // both before it reads the message, and the cards say how.
      const approvals = takeDecisions(state);
      startTurn(state, message);
      await run({ message, ...(approvals.length > 0 ? { approvals } : {}) });
    },

    /** Answer one waiting write; the turn resumes once every one is answered. */
    async decide(callId: string, approved: boolean): Promise<void> {
      if (inflight !== null || !decideOne(state, callId, approved)) return;
      startTurn(state, null);
      await run({ approvals: takeDecisions(state) });
    },

    stop(): void {
      inflight?.abort();
    },

    /** A new conversation, which starts asking again: "Allow all" was for the last one. */
    reset(): void {
      inflight?.abort();
      resetChat(state);
      mode.value = "manual";
    },
  };
}
