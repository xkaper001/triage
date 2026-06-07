import { type MessageReaction, type User, type PartialMessageReaction, type PartialUser, ChannelType } from "discord.js";
import type { BotEnv } from "../types.js";
import { webhookUrl } from "../types.js";
import { getForumChannelId } from "./store.js";

// ⬆️ (U+2B06 U+FE0F) — upvote to confirm you're affected by this unknown issue
const CONFIRM_EMOJIS = new Set(["⬆️", "arrow_up"]);

export async function handleReactionAdd(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  env: BotEnv
): Promise<void> {
  if (user.bot) return;

  if (reaction.partial) {
    try {
      reaction = await reaction.fetch();
    } catch (err) {
      console.error("Failed to fetch partial reaction:", err);
      return;
    }
  }

  const emojiName = reaction.emoji.name ?? "";
  if (!CONFIRM_EMOJIS.has(emojiName)) return;

  const message = reaction.message;
  const guildId = message.guildId;
  if (!guildId) return;

  // Only relay reactions inside forum thread posts
  const channel = message.channel;
  if (channel.type !== ChannelType.PublicThread) return;

  const forumChannelId = getForumChannelId(guildId);
  if (!forumChannelId || channel.parentId !== forumChannelId) return;

  const res = await fetch(webhookUrl(env, "alert"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "reaction_confirm",
      message_id: message.id,
      channel_id: message.channelId,
      guild_id: guildId,
      user_id: user.id,
      emoji: emojiName,
      reaction_count: reaction.count ?? 1,
    }),
  });

  if (!res.ok) {
    console.error("Kestra alert webhook failed:", res.status, await res.text());
  } else {
    console.log(`Reaction confirm relayed by ${user.id} on ${message.id}`);
  }
}
