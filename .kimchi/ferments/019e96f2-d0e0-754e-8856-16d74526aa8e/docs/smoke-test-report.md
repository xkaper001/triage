# Smoke Test Report — Phase 3 Step 2

## Date
2026-06-05

## Environment
- wrangler dev on port 8787
- `.dev.vars` with `DEV_BYPASS=true` for local testing

## Tests Run

### 1. THREAD_CREATE with missing config (setup gating)
```bash
curl -X POST http://localhost:8787 \
  -H 'Content-Type: application/json' \
  -H 'X-Signature-Ed25519: fake' \
  -H 'X-Signature-Timestamp: 1234567890' \
  -d '{"type":"THREAD_CREATE","guild_id":"1","channel_id":"2","thread":{"id":"3","name":"test","parent_id":"4"}}'
```
**Result:** HTTP 403
**Body:** `Bot setup incomplete. Missing: OPENAI_API_KEY, OPENAI_BASE_URL, DEFAULT_REPO, FORUM_CHANNEL_ID. Run /setup in this server.`
**Status:** PASS — Setup gating correctly blocks relay when required config is missing.

### 2. Missing signature headers
```bash
curl -X POST http://localhost:8787 \
  -H 'Content-Type: application/json' \
  -d '{"type":"THREAD_CREATE",...}'
```
**Result:** HTTP 401
**Body:** `Missing signature headers`
**Status:** PASS — Signature verification still enforced normally.

### 3. Discord PING (URL verification)
```bash
curl -X POST http://localhost:8787 \
  -H 'Content-Type: application/json' \
  -H 'X-Signature-Ed25519: fake' \
  -H 'X-Signature-Timestamp: 1234567890' \
  -d '{"type":1}'
```
**Result:** HTTP 200
**Body:** `{"type":1}`
**Status:** PASS — PING response works.

## Notes
- The 200 path (forum channel match + Kestra relay) was NOT tested because it requires either a running Kestra instance or a local mock of the Kestra KV API. The existing `getKv` implementation calls Kestra's REST API, so local dev cannot read config values without Kestra.
- The critical setup-gating behavior (403 on missing config) is confirmed working.
- `DEV_BYPASS` is dev-only and gated by `.dev.vars`, which is gitignored.
- TypeScript typecheck passes (`npx tsc --noEmit` — no errors).
