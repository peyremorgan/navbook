/**
 * Where test plans and runs show up in the host's client.
 *
 * The pages under `app/pages/tests` need nothing registered. These are the
 * places on somebody else's page: the header's navigation, a panel on a pull
 * request, a badge on its listing row, and a filter on the pull request
 * listing. `enforce: "pre"` so the cache policies are in before the host
 * builds its Apollo client, which reads them once.
 */

import { defineNuxtPlugin } from "#app";
import TestedBadge from "../components/TestedBadge.vue";
import TestRunsPanel from "../components/TestRunsPanel.vue";
import { TESTED_STATES } from "../utils/tests";

export default defineNuxtPlugin({
  name: "navbook-plugin-tests",
  enforce: "pre",
  setup() {
    useNavbookSlots().register({
      navLinks: [
        {
          label: "Tests",
          to: "/tests",
          icon: "i-lucide-clipboard-check",
          testid: "nav-tests",
          order: 60,
        },
      ],

      // After any other plugin's panel: a run is the last thing a reviewer
      // looks for, and the first a merger does.
      panels: [{ noun: "pr", component: TestRunsPanel, order: 110 }],

      rowBadges: [{ component: TestedBadge }],

      filters: [
        {
          param: "tested",
          apiField: "tested",
          label: "Tested",
          icon: "i-lucide-clipboard-check",
          nouns: ["pr"],
          options: () => [...TESTED_STATES],
        },
      ],

      cache: {
        typePolicies: {
          TestPlan: { keyFields: ["slug"] },
          TestRun: { keyFields: ["id"] },
          TestAttachment: { keyFields: ["path"] },
          TestStep: { keyFields: false },
          TestStepResult: { keyFields: false },
          TestPlanStats: { keyFields: false },
        },
        queryFields: {
          testPlans: { keyArgs: [] },
          testPlan: { keyArgs: ["slug"] },
          testRun: { keyArgs: ["id"] },
          testAttachment: { keyArgs: ["run", "name"] },
        },
      },

      // A plan's runs and stats change whenever a run is saved, from here or
      // from a terminal, so the listing is evicted with the host's.
      listings: ["testPlans"],
    });
  },
});
