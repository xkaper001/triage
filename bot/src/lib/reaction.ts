import { type MessageReaction, type User, type PartialMessageReaction, type PartialUser } from "discord.js";
import type { BotEnv } from "../types.js";
import { webhookUrl } from "../types.js";

const APPROVAL_EMOJIS = new Set(["✅", "👍", "✔️", "check"]);

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
  if (!APPROVAL_EMOJIS.has(emojiName)) return;

  const message = reaction.message;
  const res = await fetch(webhookUrl(env, "alert"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "approve_by_reaction",
      message_id: message.id,
      channel_id: message.channelId,
      guild_id: message.guildId,
      user_id: user.id,
      emoji: emojiName,
    }),
  });

  if (!res.ok) {
    console.error("Kestra alert webhook failed:", res.status, await res.text());
  } else {
    console.log(`Reaction approval relayed by ${user.id} on ${message.id}`);
  }
}
