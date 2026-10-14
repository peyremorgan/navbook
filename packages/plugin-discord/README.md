# @navbook/plugin-discord

A Discord bridge for a Navbook tracker. Every pull request gets a thread in a
Discord channel, and so does every issue a rule picks out. Each thread is told
what happens to its record — comments and reviews, status changes,
assignments and review requests, new revisions — and pings the people a
change asks something of. From Discord, people comment, review, assign, close
and reopen, and each of those is recorded as the person who did it, not as the
bot.

It runs inside `nav-server`, as one of its services (spec 06 §6.2): the server
already owns the clone and every change goes through it, so the bridge sees
what the API does and what anybody pushes from a terminal alike. It needs a
bot token; without one the server runs no bridge and says so.

```console
$ nav plugin install @navbook/plugin-discord
```

## What it does

**Threads.** A pull request gets a thread when the bridge first sees it,
drafts included, in the channel `prs` names. An issue gets one when a rule in
`issues` fires — when it is opened, assigned, closed or reopened, or gains a
frontmatter field or a given value of one — if it is in the rule's scope
(every issue, or only those that are nobody's subtask) and matches the rule's
query. A forum channel makes each thread a post; a text channel holds a card
for each and the thread hangs from it.

**What a thread says.** Its first message is a card: the record's title,
status, author, assignees, labels, reviews and branch, and a link to it in
the web tracker. The card is redrawn as the record changes. Below it, one
message per event: a comment or review, quoted; a status change, with why it
was closed; an assignment or a review request, which pings the person if their
Discord account is linked; a new revision; a change to a field a rule watches.
A closed or merged record's thread is archived; reopened, it comes back. A
renamed record renames its thread, at most once in five minutes, which is what
Discord allows.

**Forum tags.** In a forum, a post carries the tag named after its status
(`open`, `closed`, `merged`, `draft`) and one for each of its labels, when the
forum has a tag of that name — at most five. The bridge creates no tags:
which ones exist is the server's moderators' choice. Create `open`, `closed`,
`merged` and `draft` for the status to show.

**Commands.** All under `/nav`, in the guild the settings name:

| Command | Does |
|---|---|
| `/nav link` | Links your Discord account to you in the tracker (below) |
| `/nav unlink`, `/nav whoami` | Undoes that; says who your account acts as |
| `/nav comment [body] [id]` | Comments; a form opens without a body |
| `/nav review <verdict> [body] [id]` | Approves, requests changes, or reviews without a verdict |
| `/nav assign [user] [id]` | Assigns somebody linked, or you |
| `/nav close [resolution] [id]`, `/nav reopen [id]` | Closes or reopens an issue |
| `/nav show [id]` | Shows a record's card to you alone |
| `/nav thread <id>` | Gives a record a thread now, whatever the rules say |

Every command but `link`, `unlink` and `whoami` is for an account linked to
somebody (below): it acts as them, and shows them what they could read in
the tracker. An account linked to nobody is told how to link, and is shown
nothing — not a record's card, nor the ids and titles `id` offers to
complete.

In a record's thread, `id` can be left out. The card has buttons too:
Approve, Request changes and Comment on a pull request; Comment, Assign to me
and Close, or Reopen, on an issue. An approval made from a card is of the
revision that card showed: one pressed after a new revision is pushed is
refused rather than recorded against code nobody looked at. And any message
in a thread can be turned into a comment from its menu: **Apps → Comment on
this issue/PR**. It opens a form holding the message, quoted, with its
author's Discord name; what the form holds when it is sent is commented as
whoever sent it.

Nothing written in a thread reaches the tracker unless somebody linked asks
with one of these — and the menu lets them quote somebody else's message,
as the form shows before anything is sent. A conversation in Discord
otherwise stays in Discord.

## Setting it up

**1. The bot.** In the [Discord Developer Portal](https://discord.com/developers/applications),
create an application, and under **Bot** reset its token and copy it. The
bridge needs no privileged intent. Under **Installation**, give the guild
install the scopes `bot` and `applications.commands` and these permissions,
or use the URL below with your application's id:

- View Channels, Send Messages, Embed Links, Read Message History
- Create Public Threads, Send Messages in Threads, Manage Threads

```
https://discord.com/oauth2/authorize?client_id=<application id>&scope=bot%20applications.commands&permissions=326417599488
```

Discord may only offer forum channels once the server's Community feature is
turned on; a text channel works everywhere.

**2. The server.** Give `nav-server` the token, and the guild if you want the
server to refuse any other:

| Variable | Meaning |
|---|---|
| `NAV_SERVER_DISCORD_TOKEN` | The bot's token. Without it there is no bridge |
| `NAV_SERVER_DISCORD_GUILD` | The one guild the bridge may serve; settings naming another stop the server |
| `NAV_SERVER_DISCORD_TRUST_LINKS` | `true`: linked accounts act although the server requires a claim or a verified address (below) |

In `docker compose`, that is `NAVBOOK_DISCORD_TOKEN`,
`NAVBOOK_DISCORD_GUILD` and `NAVBOOK_DISCORD_TRUST_LINKS` in `.env`, with
`@navbook/plugin-discord` among `NAVBOOK_PLUGINS`.

**3. The settings.** In the repository's `navbook.json`, committed like the
rest of the tracker. Ids are the strings Discord shows with Developer Mode on
(right-click → Copy ID):

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
      ]
    }
  }
}
```

- `guild`: the Discord server.
- `url`: the web tracker, for the cards' links and for linking accounts.
- `prs`: where pull requests get their threads. Leave it out for none.
- `issues`: rules, weighed in order; the first that fires picks the channel.
  `on` lists triggers — `open`, `assign`, `status:open`, `status:closed`,
  `field:<key>`, `field:<key>=<value>` — and defaults to `["open"]`. `scope` is
  `root` or `all` (the default). `match` is query terms as `nav issue list`
  takes them.

`nav doctor` checks these settings, naming each fault by its key.

## Linking accounts

What somebody does from Discord is recorded as them, so the bridge has to
know who they are. `/nav link` answers, privately, with a link to the web
tracker carrying a one-time code; opened there by somebody signed in, it names
the Discord account that asked for it — display name and handle — and asks
before linking it to them. Only link an account that is yours: a code somebody
sent you is theirs, and linking it lets their account act as you. The page
lists every account linked to you, and unlinks them. The link is committed to
`people` in the settings, as `docs(discord): link <address>`.

At a terminal, a maintainer can do the same for somebody, and see who is
linked:

```console
$ nav discord link 4567890123456789012 alice@example.com --commit
$ nav discord people
$ nav discord unlink alice@example.com --commit
```

The links are in the repository, so anybody who can read it can see which
Discord account is whose. An address the settings cannot hold — one with no
dot in its domain, say — is not linked, and a link committed by hand that
does not read is left out, said once in the log, rather than stopping the
bridge.

**A link stands in for a sign-in.** Somebody acting from Discord shows the
server no token, so of the rules that decide who is allowed in
(`--allow-email-domain`, `--require-claim`, `--require-email-verified`) only
the first, which reads the address alone, can be applied to them — and is.
The other two cannot: a person removed from the group a claim names would
keep acting from Discord. So on a server that requires a claim or a
verified address, linked accounts act for nobody, and the log says so at
start, unless `NAV_SERVER_DISCORD_TRUST_LINKS` is `true`. With it, the links
are trusted in those rules' place, and taking somebody's access away means
a maintainer unlinking their account as well, at a terminal:
`nav discord unlink <address> --commit`, then push. The web tracker's page
unlinks only the accounts of whoever is signed in, and `/nav unlink` only
the account that types it — which it does whether or not links are trusted,
since unlinking only takes away.

## What is kept, and where

Everything durable is in the tree: the settings and the links. The bridge also
remembers which thread belongs to which record, and what it last saw of each,
in `navbook/discord.json` under the clone's git directory — never committed,
and disposable. Lose it and the bridge starts from the tracker as it is,
announcing nothing that happened before, and finds its threads again by their
names, which begin with the record's id — only threads the bot made, in the
channels of its own guild.

While the server is down nothing is lost: when it comes back, the bridge
tells each thread what happened meanwhile, once. While Discord is down, the
bridge tries again when the tracker moves, and otherwise after a wait that
grows from five seconds to five minutes; a message is never posted twice for
one change, and a thread whose making Discord did not confirm is looked for
before another is made. What Discord refuses for good — a channel no thread
can be made in, a name its moderation rejects — is said once in the log and
not asked again. A token Discord refuses is no such refusal: nothing is
passed over while it is, and once a new one is in, the threads are told what
they missed. The gateway, refused the token, stops trying until the server
restarts.

## What is sent to Discord

Titles, descriptions (the first 1500 characters), comments and reviews (the
first 1500 characters of each), and who did what, of every record that has a
thread — to the channels the settings name, where anybody who can read the
channel can read them. Pick the channels as you would pick who reads the
tracker. Beyond those, `/nav show` shows any record's card, and `id` offers
any record's id and title, to the person whose account is linked — what
they could read in the tracker — and to nobody else.

No message the bridge posts can ping anybody but the people a change assigns
or asks for a review, whatever the tracker's text says.

## Development

```console
$ pnpm --filter @navbook/plugin-discord test
```

The suite runs a real `nav-server` with the plugin against a Discord on
127.0.0.1 — its REST API and its gateway — so the bridge's own Discord client
is what is tested. The plugin depends on nothing at runtime: that client is
written over `fetch` and Node's `WebSocket`.
