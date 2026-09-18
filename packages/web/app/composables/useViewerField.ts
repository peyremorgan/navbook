/**
 * The signed-in person as a field that names one would have to spell them.
 *
 * What "assign it to me" needs and neither of its two sources has on its own:
 * `viewer` knows who is signed in but only as the token claims them, and
 * `people` knows how the repository spells everybody but not which of them is
 * looking. `viewerField` puts the two together (`utils/people`).
 *
 * Both queries are `cache-first` and both are asked elsewhere on every page
 * the button appears on — the layout asks for the viewer, and the assignee
 * menu beside the button asks for the people — so this costs two cache reads
 * rather than two requests.
 *
 * Null until the answer is real: not signed in, or not answered yet.
 */

import { useQuery } from "@vue/apollo-composable";
import { VIEWER_QUERY } from "~/graphql/queries";

export function useViewerField(): ComputedRef<string | null> {
  const { result } = useQuery(VIEWER_QUERY, null, { fetchPolicy: "cache-first" });
  const people = usePeople();
  return computed(() => viewerField(people.value, result.value?.viewer ?? null));
}
