/**
 * Where polls show up in the host's client.
 *
 * In the issue's discussion, where each was asked; in its sidebar, with the
 * way to open one; as a badge on its rows; as a filter on the issue listing;
 * and as a reason to be in somebody's inbox — an open poll waiting on them.
 * `enforce: "pre"` so the cache policies are in before the host builds its
 * Apollo client, which reads them once.
 */

import { defineNuxtPlugin } from "#app";
import PollBadge from "../components/PollBadge.vue";
import PollPanel from "../components/PollPanel.vue";
import PollTimelineItem from "../components/PollTimelineItem.vue";
import { readPollExt } from "../utils/poll";

export default defineNuxtPlugin({
  name: "navbook-plugin-poll",
  enforce: "pre",
  setup() {
    useNavbookSlots().register({
      timelineItems: [
        {
          noun: "issue",
          items: (ext) => readPollExt(ext).map((poll) => ({ key: poll.id, at: poll.created })),
          component: PollTimelineItem,
        },
      ],

      // Before the plugins' panels that come after the fields: a poll waiting
      // on somebody is the next thing they can do here.
      panels: [{ noun: "issue", component: PollPanel, order: 90 }],

      rowBadges: [{ component: PollBadge }],

      filters: [
        {
          param: "poll",
          apiField: "polls",
          label: "Poll",
          icon: "i-lucide-vote",
          nouns: ["issue"],
          options: () => ["open", "closed", "none"],
        },
      ],

      inboxSources: [
        {
          reason: "polls",
          label: "Polls awaiting me",
          badge: "Poll",
          icon: "i-lucide-vote",
          filter: (email) => ({ pollAwaiting: [email] }),
        },
      ],

      cache: {
        typePolicies: {
          Poll: { keyFields: ["id"] },
          PollVote: { keyFields: ["id"] },
          PollQuestion: { keyFields: false },
          PollOption: { keyFields: false },
          PollAnswer: { keyFields: false },
          PollTally: { keyFields: false },
          PollOptionCount: { keyFields: false },
          PollWriteIn: { keyFields: false },
          PollDraft: { keyFields: false },
        },
        queryFields: {
          poll: { keyArgs: ["id"] },
        },
      },
    });
  },
});
