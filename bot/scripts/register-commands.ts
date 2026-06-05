/**
 * One-time script to register Discord slash commands globally.
 * Run: pnpm register
 *
 * Requires DISCORD_BOT_TOKEN and DISCORD_APP_ID in env.
 */
import "dotenv/config";

const token = process.env.DISCORD_BOT_TOKEN;
const appId = process.env.DISCORD_APP_ID;

if (!token || !appId) {
  console.error("Missing DISCORD_BOT_TOKEN or DISCORD_APP_ID");
  process.exit(1);
}

const ADMIN_ONLY = "8"; // ADMINISTRATOR permission flag

const commands = [
  {
    name: "setup",
    type: 1,
    description: "Configure OpenAI API key, base URL, and default GitHub repo",
    default_member_permissions: ADMIN_ONLY,
  },
  {
    name: "set-api-key",
    type: 1,
    description: "Set the OpenAI API key",
    default_member_permissions: ADMIN_ONLY,
  },
  {
    name: "set-baseurl",
    type: 1,
    description: "Set the OpenAI base URL",
    default_member_permissions: ADMIN_ONLY,
    options: [
      { name: "url", description: "OpenAI-compatible base URL", type: 3, required: false },
    ],
  },
  {
    name: "set-repo",
    type: 1,
    description: "Set the default GitHub repo (OWNER/REPO)",
    default_member_permissions: ADMIN_ONLY,
    options: [
      { name: "repo", description: "Repository in OWNER/REPO format", type: 3, required: false },
    ],
  },
  {
    name: "set-forum-channel",
    type: 1,
    description: "Set the forum channel to monitor for new posts",
    default_member_permissions: ADMIN_ONLY,
    options: [
      {
        name: "channel",
        description: "The forum channel to monitor",
        type: 7,
        required: true,
        channel_types: [15], // GUILD_FORUM only
      },
    ],
  },
  {
    name: "status",
    type: 1,
    description: "Show current bot configuration",
    default_member_permissions: ADMIN_ONLY,
  },
];

const res = await fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
  method: "PUT",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bot ${token}`,
  },
  body: JSON.stringify(commands),
});

if (!res.ok) {
  console.error("Failed:", res.status, await res.text());
  process.exit(1);
}

const data = await res.json() as unknown[];
console.log(`Registered ${data.length} commands.`);
