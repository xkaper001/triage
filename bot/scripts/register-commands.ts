/**
 * One-time script to register Discord slash commands globally.
 * Run: npm run register
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

const ADMIN_ONLY = "8"; // ADMINISTRATOR permission bit

const commands = [
  {
    name: "setup",
    type: 1,
    description: "Open the bot configuration panel (AI provider, GitHub, forum channel)",
    default_member_permissions: ADMIN_ONLY,
  },
  {
    name: "repo",
    type: 1,
    description: "Set the default GitHub repository for issue filing (owner/repo)",
    default_member_permissions: ADMIN_ONLY,
    options: [
      { name: "repo", description: "Repository in owner/repo format", type: 3, required: false },
    ],
  },
  {
    name: "set-api-key",
    type: 1,
    description: "Quickly update the OpenAI API key",
    default_member_permissions: ADMIN_ONLY,
  },
  {
    name: "set-baseurl",
    type: 1,
    description: "Update the OpenAI-compatible base URL",
    default_member_permissions: ADMIN_ONLY,
    options: [
      { name: "url", description: "OpenAI-compatible base URL", type: 3, required: false },
    ],
  },
  {
    name: "setup-tags",
    type: 1,
    description: "Create triage tags on the forum channel (Known Issue, Duplicate, Needs Review, etc.)",
    default_member_permissions: ADMIN_ONLY,
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
    name: "enable",
    type: 1,
    description: "Enable automatic triage for new forum posts",
    default_member_permissions: ADMIN_ONLY,
  },
  {
    name: "disable",
    type: 1,
    description: "Pause triage — new posts are ignored until re-enabled",
    default_member_permissions: ADMIN_ONLY,
  },
  {
    name: "status",
    type: 1,
    description: "Show the currently monitored forum channel",
    default_member_permissions: ADMIN_ONLY,
  },
  {
    name: "install-github-app",
    type: 1,
    description: "Step-by-step guide to install the Triage GitHub App and link your repo",
    default_member_permissions: ADMIN_ONLY,
  },
  {
    name: "create-github-issue",
    type: 1,
    description: "Manually file a GitHub issue from this forum post (admin only)",
    default_member_permissions: ADMIN_ONLY,
  },
  {
    name: "help",
    type: 1,
    description: "Show all available commands and what they do",
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
