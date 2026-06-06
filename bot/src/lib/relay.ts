import { type ThreadChannel } from "discord.js";
import type { BotEnv } from "../types.js";
import { webhookUrl } from "../types.js";
import { getForumChannelId } from "./store.js";

export async function handleThreadCreate(thread: ThreadChannel, env: BotEnv): Promise<void> {
  const forumChannelId = getForumChannelId(thread.guildId);
  if (!forumChannelId) {
    console.log(`Forum channel not configured for guild ${thread.guildId}. Run /set-forum-channel.`);
    return;
  }
  if (thread.parentId !== forumChannelId) return;

  let firstMessage = "";
  let firstMessageId = "";
  let authorId = "";
  let authorUsername = "";
  try {
    const starter = await thread.fetchStarterMessage();
    firstMessage = starter?.content ?? "";
    firstMessageId = starter?.id ?? "";
    authorId = starter?.author?.id ?? "";
    authorUsername = starter?.author?.username ?? "";
  } catch (err) {
    console.warn("Could not fetch starter message:", err);
  }

  const res = await fetch(webhookUrl(env, "triage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      discord_thread_id: thread.id,
      discord_channel_id: thread.id,
      discord_guild_id: thread.guildId,
      thread_name: thread.name,
      parent_channel_id: thread.parentId,
      first_message: firstMessage,
      first_message_id: firstMessageId,
      author_id: authorId,
      author_username: authorUsername,
    }),
  });

  if (!res.ok) {
    console.error("Kestra triage webhook failed:", res.status, await res.text());
  } else {
    console.log(`Relayed thread ${thread.id} (${thread.name})`);
  }
}
