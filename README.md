# Triage Bot

Automated Discord forum bug triage. When a new post appears in a configured forum channel, the bot relays it to Kestra, which runs an AI agent (via Coral MCP) to search GitHub issues and Discord for duplicates — then replies, adds reactions, and escalates to GitHub automatically.

## How it works

```
New forum post
  → bot relays to Kestra (discord_triage flow)
  → AI agent searches GitHub (3 angle queries, hybrid mode)
      ✅ Match found → reply with issue link + ✅ reaction
      ⚠️  No GitHub match → search Discord forum for duplicate posts
          🔁 Duplicate found → archive new post, notify original, increment reporter count
              3+ dup posts → auto-create GitHub issue
          ℹ️  No duplicate → reply "unknown issue", add ⬆️ upvote

⬆️ Upvote on unknown-issue post (by any user)
  → bot relays reaction count to Kestra (triage_draft_alert flow)
  → at count ≥ 3 → draft + create GitHub issue → reply with link
```

## Setup

### 1. Bot environment (`bot/.env`)

```env
DISCORD_BOT_TOKEN=
KESTRA_CLOUD_URL=https://your-kestra-instance
KESTRA_NAMESPACE=discord.triage
KESTRA_TRIAGE_WEBHOOK_KEY=3Kua0DFmXL
KESTRA_ALERT_WEBHOOK_KEY=AlertKey9x2
KESTRA_CONFIG_WEBHOOK_KEY=0j8BRKoiXR
```

Webhook keys must match the `key:` values in the Kestra flow YAML files.

### 2. Discord Developer Portal

- Enable **Message Content** privileged intent (Bot → Privileged Gateway Intents)
- Register slash commands (one-time, also when commands change):
  ```bash
  cd bot
  DISCORD_APP_ID=your_app_id npm run register
  ```

### 3. Deploy Kestra flows

Upload all three YAML files from `kestra/flows/` to your Kestra instance under namespace `discord.triage`:
- `discord_triage.yaml`
- `triage_draft_alert.yaml`
- `update_config.yaml`

### 4. Per-guild configuration (via slash commands)

Run these in your Discord server (admin only):

| Command | What it sets |
|---|---|
| `/set-forum-channel #channel` | Forum channel to monitor (stored locally on bot) |
| `/setup` | OpenAI API key, base URL, GitHub repo + token, admin channel |
| `/set-api-key` | Update OpenAI API key only |
| `/set-baseurl [url]` | Update OpenAI-compatible base URL |
| `/set-repo [owner/repo]` | Update default GitHub repo |
| `/status` | Show current forum channel config |

Config (except forum channel) is stored in Kestra KV store as `GUILD_{guild_id}_{KEY}`.

### 5. Coral MCP

Set the Coral MCP URL in Kestra KV:
- Key: `GUILD_{your_guild_id}_CORAL_MCP_URL`
- Default if not set: `http://host.docker.internal:8000/mcp`

Coral provides read-only SQL access to GitHub and Discord data used by the AI triage agent.

### 6. Optional KV overrides

| KV Key | Default | Description |
|---|---|---|
| `TRIAGE_ENABLED` | `true` | Set to any non-`true` value to disable triage |
| `GUILD_{id}_OPENAI_BASE_URL` | `https://llm.kimchi.dev/openai/v1` | OpenAI-compatible API base |
| `GUILD_{id}_CORAL_MCP_URL` | `http://host.docker.internal:8000/mcp` | Coral MCP endpoint |

## Running locally

```bash
cd bot
npm install
npm run dev    # hot-reload via tsx watch
```

## Docker

```bash
cd bot
docker compose up
```

The compose file mounts `/data` for forum channel config persistence.
