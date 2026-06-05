# Discord → Coral → GitHub Triage

A serverless triage pipeline that reads Discord forum posts, semantically matches them against live GitHub issues via Coral MCP, clusters unmatched reports in Qdrant, drafts aggregated issues when clusters hit ≥3 reports, and routes human approval through Discord reactions back to Kestra to create real GitHub issues.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  Discord Forum  │────▶│  Cloudflare      │────▶│  Kestra Cloud       │
│  (THREAD_CREATE)│     │  Worker          │     │  discord_triage     │
└─────────────────┘     │  + interactions  │     └─────────────────────┘
       │                └──────────────────┘              │
       │                          ▲                       │
       │                          │                       ▼
┌──────┴──────┐           ┌───────┴──────┐      ┌─────────────────────┐
│  Admin      │◀──────────│  triage_     │      │  Qdrant             │
│  reactions  │           │  draft_alert │      │  + OpenAI           │
│  (✅ / ❌)  │           └──────────────┘      └─────────────────────┘
└─────────────┘                                          │
                                                         ▼
                                                  ┌──────────────┐
                                                  │  GitHub      │
                                                  │  Issues      │
                                                  └──────────────┘
```

### Flow

1. **Discord forum post** → Cloudflare Worker receives `THREAD_CREATE` webhook
2. **Worker verifies signature**, checks required config, filters by forum channel, and relays payload to `Kestra / discord_triage`
3. **Kestra** fetches thread messages, summarizes with minimax-m2.7, computes embedding, and searches live GitHub issues via **Coral MCP**
4. **LLM Judge A** decides: MATCH existing GitHub issue, or NO_MATCH
5. **On NO_MATCH**: search Qdrant `discord_unmatched`, run **LLM Judge B** for cluster assignment
6. **Upsert** report to `discord_unmatched` with cluster ID; when cluster reaches ≥3 reports, trigger `triage_draft_alert`
7. **Draft alert** fetches cluster, drafts GitHub issue with GPT-4o, posts to Discord admin channel with Approve/Reject buttons
8. **Admin approval** (✅ reaction or button) → Worker relays to `triage_draft_alert` → creates real GitHub issue
9. **Scheduled cleanup**: `memory_cleanup` deletes unmatched points older than 30 days at 03:00 UTC

## Prerequisites

- [Node.js](https://nodejs.org/) ≥ 20
- [pnpm](https://pnpm.io/) ≥ 9
- [wrangler](https://developers.cloudflare.com/workers/wrangler/) CLI
- Accounts:
  - [Discord Developer Portal](https://discord.com/developers/applications) app with Bot user
  - [Kestra Cloud](https://kestra.io/cloud) namespace
  - [Qdrant Cloud](https://qdrant.tech/cloud) cluster
  - [GitHub](https://github.com/settings/tokens) personal access token
  - [OpenAI](https://platform.openai.com/api-keys) API key

## Environment Variables

### Cloudflare Worker Secrets

Set via `wrangler secret put`:

| Secret | Description |
|--------|-------------|
| `DISCORD_PUBLIC_KEY` | Discord app public key for webhook signature verification |
| `DISCORD_BOT_TOKEN` | Discord bot token (for fetching thread messages) |
| `KESTRA_API_TOKEN` | Kestra Cloud API token |

### Kestra KV Store & Secrets

| Key / Secret | Type | Description |
|--------------|------|-------------|
| `DEFAULT_REPO` | KV | GitHub repo to monitor (OWNER/REPO) |
| `OPENAI_BASE_URL` | KV | OpenAI-compatible API base URL |
| `FORUM_CHANNEL_ID` | KV | Discord forum channel for feedback posts |
| `ADMIN_CHANNEL_ID` | KV | Discord channel for draft alerts |
| `TRIAGE_ENABLED` | KV | `"true"` or `"false"` to gate triage |
| `QDRANT_URL` | KV | Qdrant Cloud REST URL |
| `OPENAI_API_KEY` | Secret | OpenAI API key |
| `QDRANT_API_KEY` | Secret | Qdrant Cloud API key |
| `GITHUB_TOKEN` | Secret | GitHub personal access token |
| `DISCORD_BOT_TOKEN` | Secret | Same Discord bot token |
| `KESTRA_CLOUD_URL` | KV | Kestra Cloud base URL |
| `KESTRA_API_TOKEN` | Secret | Same Kestra API token |

### Local

```bash
export QDRANT_URL=https://xxx.cloud.qdrant.io
export QDRANT_API_KEY=your-qdrant-key
```

## Setup

### 1. Discord App

1. Create an app at [Discord Developer Portal](https://discord.com/developers/applications)
2. Enable **Bot** user and copy the token
3. Enable **MESSAGE CONTENT INTENT** under Privileged Gateway Intents
4. Add the bot to your server with `Read Messages`, `Send Messages`, `Read Message History` permissions
5. In the **Webhooks** tab, set the **Interactions Endpoint URL** to your Worker URL
6. Enable **Events** for `THREAD_CREATE` and `MESSAGE_REACTION_ADD`

### 2. Qdrant Collections

```bash
pip install qdrant-client
python scripts/setup_qdrant.py
```

Creates one collection with 1536-dim cosine vectors (OpenAI `text-embedding-3-small`):
- `discord_unmatched`

### 3. Discord Slash Commands

After deploying the worker, register the slash commands:

```bash
cd worker
export DISCORD_BOT_TOKEN=...
export DISCORD_APP_ID=...
npx tsx scripts/register-commands.ts
```

Users can then run `/setup` in Discord to open a modal and configure:
- OpenAI API key
- OpenAI base URL
- Default repo (OWNER/REPO)
- Forum channel ID

Or use individual commands:
- `/set-api-key`
- `/set-baseurl <url>`
- `/set-repo <repo>`
- `/set-forum-channel <channel>`

### 4. Kestra Cloud

1. Create a namespace `discord.triage`
2. Upload the flow YAMLs from `kestra/flows/` into the namespace
3. Configure KV values and secrets in the Kestra UI
4. Copy the Kestra Cloud URL and API token

### 5. Cloudflare Worker

```bash
cd worker
pnpm install
wrangler dev        # local dev
wrangler deploy     # production
```

Set secrets:
```bash
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put DISCORD_BOT_TOKEN
wrangler secret put KESTRA_API_TOKEN
```

Update `wrangler.toml` env vars:
```toml
[vars]
KESTRA_CLOUD_URL = "https://app.kestra.cloud"
KESTRA_NAMESPACE = "discord.triage"
```

## Deployment Steps

1. **Worker**: `cd worker && wrangler deploy`
2. **Flows**: Import `kestra/flows/*.yaml` into Kestra Cloud `discord.triage` namespace
3. **Qdrant**: `python scripts/setup_qdrant.py`
4. **Discord**: Set the Worker URL as the Interactions endpoint and Events webhook URL
5. **Verify**: Run the smoke tests below

## Operational Notes

- **Logs**: Kestra execution logs show LLM judge responses, Coral MCP results, Qdrant search results, and Discord API status codes
- **Retry**: Kestra tasks have `PT5M` timeout and `QUEUE` concurrency limit of 1
- **Disabling triage**: Set KV `TRIAGE_ENABLED` to `"false"`; the `discord_triage` flow will log and skip
- **Manual issue creation**: Admins can react ✅ to a draft message even if it hasn't hit the threshold — the worker relays to `triage_draft_alert`
- **Rate limits**: OpenAI embedding API and Coral MCP are the main rate-limit surfaces
- **Setup gate**: The worker blocks all webhooks until the four required config values are set via `/setup`

## Smoke Tests

### Setup Gate (Incomplete Config)

Without config, the worker should return 403:
```bash
curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:8787 \
  -H "Content-Type: application/json" \
  -d '{
    "type": "THREAD_CREATE",
    "guild_id": "1",
    "channel_id": "2",
    "thread": {"id": "3", "name": "test", "parent_id": "4"}
  }'
# Expected: 403
```

### Relay Webhook (THREAD_CREATE)

```bash
curl -X POST https://<your-worker>.workers.dev \
  -H "Content-Type: application/json" \
  -H "X-Signature-Ed25519: <valid-signature>" \
  -H "X-Signature-Timestamp: <timestamp>" \
  -d '{
    "type": "THREAD_CREATE",
    "guild_id": "123456789",
    "channel_id": "987654321",
    "thread": {
      "id": "111222333",
      "name": "Bug: login fails on Safari",
      "parent_id": "444555666"
    }
  }'
```

*(Replace with a real Discord-signed request, or use `wrangler dev` to inspect local logs.)*

### Discord Interaction Approval

```bash
# Simulate a button click from Discord
curl -X POST https://<your-worker>.workers.dev \
  -H "Content-Type: application/json" \
  -H "X-Signature-Ed25519: <valid-signature>" \
  -H "X-Signature-Timestamp: <timestamp>" \
  -d '{
    "type": 3,
    "id": "interaction-id-123",
    "token": "interaction-token-456",
    "message": {"id": "msg-789", "embeds": []},
    "data": {"custom_id": "approve_issue:cluster-abc123"},
    "member": {"user": {"id": "user-111", "username": "admin"}}
  }'
```

## Project Structure

```
.
├── worker/                          # Cloudflare Worker
│   ├── src/
│   │   ├── index.ts                 # main fetch handler + routing
│   │   ├── lib/
│   │   │   ├── verify.ts           # Discord Ed25519 signature verification
│   │   │   ├── relay.ts            # THREAD_CREATE → Kestra
│   │   │   ├── interaction.ts      # button interactions
│   │   │   ├── reaction.ts         # MESSAGE_REACTION_ADD
│   │   │   ├── commands.ts         # slash commands + modals
│   │   │   ├── kv.ts               # Kestra KV/secret client
│   │   │   └── config.ts           # required config validation
│   │   └── types.ts                # shared Env + payload types
│   ├── scripts/
│   │   └── register-commands.ts    # global Discord slash command registration
│   ├── wrangler.toml
│   ├── package.json
│   └── tsconfig.json
├── kestra/flows/
│   ├── discord_triage.yaml          # webhook triage pipeline (Coral MCP)
│   ├── triage_draft_alert.yaml      # draft + approval routing
│   └── memory_cleanup.yaml          # daily old-point cleanup
├── prompts/
│   ├── prompt_a_github_match.md     # LLM Judge A
│   └── prompt_b_cluster_match.md    # LLM Judge B
├── scripts/
│   └── setup_qdrant.py              # collection initializer
└── README.md
```

## License

MIT
