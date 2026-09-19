/**
 * The field sets this plugin's operations are built from.
 *
 * A fragment registry does not cross a package. `@navbook/web` generates from
 * the host's schema and its own documents; this layer generates from the
 * composed schema and its own. So the three entity fragments below repeat, by
 * hand, exactly what `IssueListItem` and `PrListItem` select over there.
 *
 * That repetition is deliberate and it is checked. A feature's timeline draws
 * its issues and pull requests with the host's own `IssueRow` and `PrRow`
 * components, which are typed against the host's fragments — so if a field is
 * added there and not here, this layer stops type checking rather than
 * rendering a row with a hole in it. The alternative was for the host's
 * documents to select `features`, which would mean `@navbook/web` could not be
 * built without this package installed.
 *
 * `ext` is selected for the same reason the host selects it: a row component
 * draws whatever the loaded plugins put on an entity (spec 06 §6.3), and this
 * plugin's own chips are among them.
 */

import { graphql } from "../../src/generated/gql";

/** What `EntityCore` selects in `@navbook/web`, field for field. */
export const KB_ENTITY_CORE = graphql(`
  fragment KbEntityCore on Entity {
    id
    slug
    kind
    status
    path
    archived
    title
    author
    created
    labels
    assignees
    milestone
    ext
  }
`);

/** What `IssueListItem` selects; `IssueRow` is typed against that. */
export const KB_ISSUE_ROW = graphql(`
  fragment KbIssueRow on Issue {
    ...KbEntityCore
    resolution
    rank
    deadline
  }
`);

/** What `PrListItem` selects; `PrRow` is typed against that. */
export const KB_PR_ROW = graphql(`
  fragment KbPrRow on Pr {
    ...KbEntityCore
    target
    source
    draft
    refs
    reviewers
    reviewDecision
    approvals {
      given
      required
    }
    merged {
      date
      by
      commit
    }
  }
`);

/**
 * A feature as its listing row shows it, members included for the counts.
 *
 * `path` is selected on each document although the row never draws it: it is
 * the cache key for a `Spec`, and a normalised object Apollo cannot key is an
 * error rather than a quietly denormalised copy.
 */
export const FEATURE_LIST_ITEM = graphql(`
  fragment FeatureListItem on Feature {
    slug
    title
    author
    created
    summary
    specs {
      path
      fileName
      title
    }
    issues {
      id
      status
    }
    prs {
      id
      status
    }
  }
`);

/** One of a feature's documents, whole. */
export const SPEC_DETAIL = graphql(`
  fragment SpecDetail on Spec {
    fileName
    title
    path
    body
    baseSha
  }
`);

/**
 * A feature's page: the card, its documents, and the work and history that
 * make up its timeline. The entities come back as list rows because that is
 * what the timeline renders them as.
 */
export const FEATURE_DETAIL = graphql(`
  fragment FeatureDetail on Feature {
    slug
    title
    author
    created
    summary
    path
    baseSha
    specs {
      ...SpecDetail
    }
    issues {
      ...KbIssueRow
    }
    prs {
      ...KbPrRow
    }
    commits {
      sha
      subject
      author
      date
    }
  }
`);
