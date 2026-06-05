import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const CONFIG_PATH = process.env.CONFIG_PATH ?? "/data/config.json";

interface Config {
  forumChannels?: Record<string, string>; // guildId -> channelId
}

let _config: Config = {};

export function loadConfig(): void {
  if (existsSync(CONFIG_PATH)) {
    try {
      _config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
      console.log("Config loaded from", CONFIG_PATH);
    } catch {
      _config = {};
    }
  }
  // Env var as legacy seed for single-guild deployments
  if (process.env.FORUM_CHANNEL_ID && process.env.GUILD_ID) {
    _config.forumChannels ??= {};
    _config.forumChannels[process.env.GUILD_ID] ??= process.env.FORUM_CHANNEL_ID;
  }
}

export function getForumChannelId(guildId: string): string | null {
  return _config.forumChannels?.[guildId] ?? null;
}

export function setForumChannelId(guildId: string, channelId: string): void {
  _config.forumChannels = { ..._config.forumChannels, [guildId]: channelId };
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(_config, null, 2));
}
