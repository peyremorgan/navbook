# The Discord bridge

**Normative.** This document defines what `@navbook/plugin-discord` keeps in a
Navbook tree, in the sense the [Navbook specification](../../../doc/spec/README.md)
defines the rest of it, and what it keeps outside one. A plugin that owns data
must publish such a document ([02 §2.12](../../../doc/spec/02-data-model.md)).

The bridge owns very little data. It keeps no file beside an issue or pull
request, no frontmatter key and no directory of its own. Everything it writes
into the tree is its settings, in the marker, and the only part of those it
ever writes itself is the `people` map.

## The data

| What | Where | Written by |
|---|---|---|
| The bridge's settings | `plugins["@navbook/plugin-discord"]` in `navbook.json` | whoever configures it |
| Links between Discord accounts and people | its `people` key | `linkDiscord` and `/nav unlink` over the API, `nav discord link` and `unlink` at a terminal, or by hand |

Settings under a plugin's name are committed, shared by every clone, and
therefore never secret ([02 §2.12](../../../doc/spec/02-data-model.md)). The
bot's token is not among them: it is the server's, in its environment.

### Settings

```json
{
  "version": 1,
  "plugins": {
    "@navbook/plugin-discord": {
      "guild": "1234567890123456789",
      "url": "https://tracker.example.com",
      "prs": { "channel": "2345678901234567890" },
      "issues": [
        { "channel": "3456789012345678901", "scope": "root", "on": ["open"] },
        {
          "channel": "3456789012345678901",
          "on": ["assign", "status:closed", "field:priority=high"],
          "match": "label:bug"
        }
      ],
      "people": { "4567890123456789012": "alice@example.com" }
    }
  }
}
```

| Key | Req. | Type | Meaning |
|---|---|---|---|
| `guild` | MUST | Discord id | The Discord server the bridge posts in and answers commands from |
| `url` | MAY | http(s) URL | The web tracker, for links on cards and for linking accounts |
| `prs` | MAY | object | `{ "channel": <id> }`: where every pull request gets a thread |
| `issues` | MAY | list of rules | When an issue gets a thread, and where (below) |
| `people` | MAY | object | Discord user id to the address it acts as (below) |

A **Discord id** is a snowflake written as a JSON string of 17 to 20 digits,
since JSON numbers cannot carry one exactly. A channel is a forum channel, in
which each thread is a post with tags, or a text channel, in which each thread
hangs from a message holding its card.

Each **rule** in `issues` is an object:

| Key | Req. | Type | Meaning |
|---|---|---|---|
| `channel` | MUST | Discord id | Where the threads it opens go |
| `scope` | MAY | `root` \| `all` | `root`: only issues with no `parent` ([02 §2.5](../../../doc/spec/02-data-model.md)); `all` by default |
| `on` | MAY | list of triggers | What opens a thread; `["open"]` by default |
| `match` | MAY | string or list of strings | Query terms ([04 §4.3](../../../doc/spec/04-cli.md)) the issue must match; none matches all |

The triggers:

| Trigger | Fires when the issue |
|---|---|
| `open` | is first seen |
| `assign` | gains an assignee |
| `status:open`, `status:closed` | moves into that status |
| `field:<key>` | gains frontmatter key `<key>`, or the key's value changes |
| `field:<key>=<value>` | comes to have `<value>` for `<key>`: the scalar equals it, or the list newly contains it |

An issue first seen already assigned, or already carrying a key, fires
`assign` and `field:` as one that gained them a moment later would. Rules are
weighed in the order written; the first whose trigger fires, whose scope holds
the issue and whose query it matches decides the channel. An issue keeps the
thread it got, whatever fires later. A pull request gets a thread when it is
first seen, in `prs`'s channel, drafts included.

### The people map

`people` maps a Discord user id to an email address:

- The key is a Discord id, as above. The value is a bare address, with no
  display name ([02 §2.4](../../../doc/spec/02-data-model.md)).
- An account acts as the person whose address it maps to: what it writes is
  recorded with that person as `author:`.
- Several accounts may map to one address. Addresses compare as the format
  compares them, case-insensitively.
- A tool that writes the map writes the whole marker back as JSON indented by
  two spaces with a final newline, as `nav init` does, and touches nothing
  outside the map. An emptied map is removed rather than left as `{}`.

**Discord ids are committed.** Everybody who can read the repository can read
which Discord account belongs to which address. A team that would rather not
publish that should not use the bridge's commands.

## What the plugin contributes

**Commit scope** — `docs(discord): link <address>` and
`docs(discord): unlink <address>`, as
[03 §3.2](../../../doc/spec/03-merge-and-branches.md) describes.

**Check** — `X-discord-1` (error): the settings do not read. Each fault is
named by the key it is about, as `issues[1].on[0]`.

**Commands** — `nav discord link <discord-user-id> <email>`,
`nav discord unlink <id-or-email>` and `nav discord people`.

**API** — `Query.discord`, `Viewer.discord`, and the `linkDiscord` and
`unlinkDiscord` mutations; `thread` under `ext.discord` on every issue and
pull request. See `schema.graphql` beside this file.

**The bridge** — a service of the server, run when the server has a bot token.
How it behaves is the README's to describe; what it keeps is below.

## What the bridge keeps outside the tree

The bridge remembers which thread belongs to which record, what each record
looked like when it last looked, and which threads it asked Discord for
without hearing back, in `navbook/discord.json` under the
served clone's git directory. That file is outside the working tree, so it is
never committed and never makes the clone dirty. It is disposable in the sense
of [06 §6.6](../../../doc/spec/06-future.md):

- Lost, the bridge starts from the tracker as it is then and announces nothing
  that happened before, and it finds its threads again by their names, which
  begin with `#<id> `.
- Kept, a restart announces what happened while the server was down, and
  nothing twice.

## What a tree looks like without it

A `nav` without this plugin preserves the settings, as it preserves any key of
the marker it does not read ([02 §2.10](../../../doc/spec/02-data-model.md)),
and says once that the marker declares a plugin it does not have. Nothing else
in the tree belongs to the plugin, so nothing else changes.
