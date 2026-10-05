/**
 * The part of Discord's API v10 the bridge speaks, typed by hand.
 *
 * Deliberately small: the bridge creates threads, posts and edits messages,
 * answers interactions and registers one command. A full typing of the API is
 * a package of its own, and this plugin depends on nothing at runtime; these
 * are the shapes it reads and writes, as Discord documents them
 * (https://docs.discord.com/developers). Fields the bridge never reads are
 * left out, and every object Discord sends may carry more than is listed.
 */

export const API_VERSION = 10;
export const DEFAULT_API_URL = `https://discord.com/api/v${API_VERSION}`;

/** Channel types the bridge creates threads in, or is handed back. */
export const ChannelType = {
  GuildText: 0,
  PublicThread: 11,
  GuildForum: 15,
} as const;

export interface ForumTag {
  id: string;
  name: string;
  moderated?: boolean;
}

export interface Channel {
  id: string;
  type: number;
  guild_id?: string;
  name?: string;
  parent_id?: string | null;
  available_tags?: ForumTag[];
  applied_tags?: string[];
  thread_metadata?: { archived: boolean; locked?: boolean; archive_timestamp?: string };
}

export interface User {
  id: string;
  username: string;
  global_name?: string | null;
  bot?: boolean;
}

export interface Message {
  id: string;
  channel_id: string;
  content: string;
  author?: User;
  embeds?: Embed[];
}

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface Embed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: EmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

export const ButtonStyle = { Primary: 1, Secondary: 2, Success: 3, Danger: 4 } as const;

export interface Button {
  type: 2;
  style: number;
  label: string;
  custom_id: string;
  disabled?: boolean;
}

export interface ActionRow {
  type: 1;
  components: Button[];
}

export interface AllowedMentions {
  parse: ("users" | "roles" | "everyone")[];
  users?: string[];
}

/** What a message is made of, when posted or edited. */
export interface MessageBody {
  content?: string;
  embeds?: Embed[];
  components?: ActionRow[];
  allowed_mentions?: AllowedMentions;
  /** 64: only the person who asked sees it — for an interaction's reply. */
  flags?: number;
}

export const EPHEMERAL = 64;

/** A modal's text field, inside the label that names it (component type 18). */
export interface ModalField {
  type: 18;
  label: string;
  description?: string;
  component: {
    type: 4;
    custom_id: string;
    /** 1: one line; 2: a paragraph. */
    style: 1 | 2;
    required: boolean;
    max_length?: number;
    value?: string;
  };
}

export interface Modal {
  custom_id: string;
  title: string;
  components: ModalField[];
}

export const InteractionType = {
  Ping: 1,
  Command: 2,
  Component: 3,
  Autocomplete: 4,
  ModalSubmit: 5,
} as const;

export const CommandType = { ChatInput: 1, Message: 3 } as const;

export const OptionType = { SubCommand: 1, String: 3, User: 6 } as const;

export interface CommandOption {
  type: number;
  name: string;
  value?: string | number | boolean;
  focused?: boolean;
  options?: CommandOption[];
}

export interface Interaction {
  id: string;
  application_id: string;
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  member?: { user: User };
  user?: User;
  data?: {
    id?: string;
    name?: string;
    type?: number;
    options?: CommandOption[];
    target_id?: string;
    resolved?: { messages?: Record<string, Message>; users?: Record<string, User> };
    custom_id?: string;
    components?: unknown[];
  };
  message?: Message;
}

export const InteractionResponseType = {
  Pong: 1,
  ChannelMessage: 4,
  DeferredChannelMessage: 5,
  AutocompleteResult: 8,
  Modal: 9,
} as const;

/** A command as it is registered (`PUT /applications/{id}/guilds/{guild}/commands`). */
export interface CommandDefinition {
  name: string;
  type: number;
  description?: string;
  options?: CommandDefinitionOption[];
  /** 0: in a server only. */
  contexts?: number[];
}

export interface CommandDefinitionOption {
  type: number;
  name: string;
  description: string;
  required?: boolean;
  autocomplete?: boolean;
  max_length?: number;
  choices?: { name: string; value: string }[];
  options?: CommandDefinitionOption[];
}

/** What `GET /gateway/bot` answers. */
export interface GatewayBot {
  url: string;
}

/** The gateway's opcodes the bridge handles. */
export const GatewayOp = {
  Dispatch: 0,
  Heartbeat: 1,
  Identify: 2,
  Resume: 6,
  Reconnect: 7,
  InvalidSession: 9,
  Hello: 10,
  HeartbeatAck: 11,
} as const;

/** The one intent the bridge asks for: guilds, which carries thread events. */
export const INTENT_GUILDS = 1 << 0;

export interface GatewayPayload {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
}

export interface Ready {
  session_id: string;
  resume_gateway_url: string;
  user: User;
  application: { id: string };
}
