# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Bot Commands (run inside `bot/`)

```bash
npm run dev          # tsx watch — hot-reload during development
npm run build        # tsc — compile to dist/
npm run start        # run compiled dist/index.js
npm run register     # one-time slash command registration (needs DISCORD_APP_ID in env)
npx tsc --noEmit     # type-check without emitting
```

`npm run register` requires `DISCORD_APP_ID` (not needed at runtime). Run once per Discord app, or whenever slash commands change.

## Architecture

This is a two-layer system: the bot is a thin relay, Kestra is the orchestrator.

```
Discord forum post → bot (ThreadCreate) → Kestra webhook → AI triage → Discord actions
Discord ➕ reaction → bot (ReactionAdd)  → Kestra webhook → escalation → GitHub issue
Slash command       → bot (Interaction)  → Kestra webhook → KV store (per-guild config)
```

### Bot (`bot/src/`)

- **`types.ts`** — `BotEnv` (6 required env vars), `webhookUrl(env, flow)`. The `FLOW_MAP` maps flow names to their webhook keys and Kestra flow IDs. Adding a new webhook flow requires updating this map.
- **`lib/store.ts`** — forum channel config persisted to `/data/config.json` (default) or `CONFIG_PATH`. This is the only state stored locally on the bot; all other per-guild config lives in Kestra KV.
- **`lib/relay.ts`** — handles `ThreadCreate`. Fires when a new post appears in the watched forum channel. Fetches the starter message to get `first_message_id` (needed for reactions API).
- **`lib/reaction.ts`** — handles `MessageReactionAdd` for ➕ emoji only. Filters to PublicThread children of the configured forum channel. Sends Discord's `reaction.count` directly (avoids server-side double-counting).
- **`lib/commands.ts`** — slash commands, modals, and buttons. `/set-forum-channel` stores locally via `store.ts`. All other config (`/setup`, `/set-api-key`, etc.) is POSTed to the `update_config` Kestra webhook, which writes to KV as `GUILD_{guild_id}_{KEY}`.

ESM project (`"type": "module"`) — imports inside `.ts` files must use `.js` extensions.

### Kestra (`kestra/flows/`)

Three flows:

| File | Webhook key | Trigger |
|---|---|---|
| `discord_triage.yaml` | `3Kua0DFmXL` (`KESTRA_TRIAGE_WEBHOOK_KEY`) | New forum post |
| `triage_draft_alert.yaml` | `AlertKey9x2` (`KESTRA_ALERT_WEBHOOK_KEY`) | ➕ reaction on no_match post |
| `update_config.yaml` | `0j8BRKoiXR` (`KESTRA_CONFIG_WEBHOOK_KEY`) | Slash command config write |

**`discord_triage.yaml`** — main flow:
1. `gate` (Switch on KV `TRIAGE_ENABLED`, default true)
2. `triage_agent` (AIAgent + Coral MCP) — searches GitHub (3 angle queries), then Discord forum for duplicates; returns `{outcome, ...}`
3. `parse_result` (Python) — JSON extraction with regex fallback; downgrades `discord_duplicate` with no thread_id to `no_match`
4. `reply_to_thread` — always posts the reply message
5. Branch on outcome:
   - `github_match` → ✅ reaction
   - `discord_duplicate` → archive new thread, notify old thread, 🔁 reaction; increment `_REPORTERS` KV counter; at ≥3 dup posts → auto-draft + create GitHub issue
   - `no_match` → ➕ reaction, store `{"status":"no_match"}` in `GUILD_{gid}_THREAD_{tid}_TRIAGE`

**`triage_draft_alert.yaml`** — reaction escalation:
1. Read `_TRIAGE` KV key; skip if not `no_match` or already `escalated`
2. At `reaction_count >= 3`: claim slot (`status=escalated`), run draft AIAgent, create GitHub issue, reply to thread

### KV Store naming

All per-guild config: `GUILD_{guild_id}_{KEY}` (e.g. `GUILD_123_OPENAI_API_KEY`)

Per-thread tracking:
- `GUILD_{gid}_THREAD_{orig_tid}_REPORTERS` — duplicate-post counter `{"count": N, "thread_ids": [...]}`
- `GUILD_{gid}_THREAD_{tid}_TRIAGE` — unknown-issue status `{"status": "no_match"|"escalated"}`

### Coral MCP

Read-only SQL interface. Used inside Kestra AIAgent via `StreamableHttpMcpClient`. URL stored in KV as `GUILD_{gid}_CORAL_MCP_URL` (default: `http://host.docker.internal:8000/mcp`).

Key queries:
```sql
-- GitHub issue search
SELECT title, html_url, number, state
FROM github.search_issues(q => 'repo:OWNER/REPO is:issue is:open KEYWORDS', mode => 'hybrid')
WHERE is_pull_request = false LIMIT 5

-- Discord forum posts / thread messages
SELECT id, content, permalink, timestamp
FROM discord.messages
WHERE channel_id = 'FORUM_OR_THREAD_ID'
LIMIT 50
```

## Deployment

Bot is containerized (`bot/Dockerfile`) and deployed via Portainer with auto-deploy on push. Config volume mounts `/data` for `config.json` persistence.

Privileged Discord intent required: **Message Content** (enable in Discord Developer Portal → Bot → Privileged Gateway Intents).
