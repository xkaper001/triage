# Kestra YAML Modernization Spec

## Ferment: Update Kestra Flows to Use Native Plugins

## Goal
Rewrite all 4 Kestra flow YAMLs to maximize native Kestra plugin usage, modernize remaining Python scripts, and leverage Kestra Cloud's full capabilities.

## Assumptions
- Target environment: Kestra Cloud (latest stable)
- Qdrant collection schemas remain unchanged (structure already suitable)
- Python scripts may remain ONLY for operations with no native Kestra plugin equivalent (standalone embedding generation + structured Qdrant upsert)
- All Python scripts that remain MUST use `dependencies` instead of `beforeCommands`, and declare explicit `taskRunner`/`containerImage`
- Pebble/JQ expressions can parse HTTP response bodies for downstream task templating

## Constraints
- Webhook trigger keys must stay the same (`discord_triage_webhook`) to avoid breaking Discord integration
- KV store keys and secret names must stay the same
- Flow IDs and namespace (`discord.triage`) must stay the same
- Business behavior must be preserved: same inputs, same outputs, same triggering patterns
- No new external dependencies beyond what's available in Kestra Cloud

---

## Phase 1: Fully Declarative — memory_cleanup.yaml

**Scope:** Replace all inline Python with native HTTP Request tasks calling Qdrant REST API.

**Current state:** A single Python script that counts old points and deletes them using `qdrant_client`.

**New design:**
1. **Task `compute_cutoff`** — `io.kestra.plugin.core.debug.Return` to compute ISO cutoff timestamp using Pebble: `{{ now() | dateAdd(-inputs.retention_days, 'DAYS') | date('yyyy-MM-dd') }}`
2. **Task `count_old`** — `io.kestra.plugin.core.http.Request`
   - `uri`: `{{ inputs.qdrant_url }}/collections/{{ inputs.qdrant_collection }}/points/count`
   - `method`: POST
   - `headers`: `api-key: {{ inputs.qdrant_api_key }}`
   - `body`: JSON with `filter` on `created_at` field using `range.lt`
3. **Task `maybe_delete`** — `io.kestra.plugin.core.flow.If` conditioned on `{{ outputs.count_old.body | json | jq('.result.count') > 0 }}`
   - Then branch: `io.kestra.plugin.core.http.Request` to `DELETE /collections/{collection}/points/delete` with same filter
4. **Finally:** `io.kestra.plugin.core.log.Log` to log results

**Acceptance criteria:**
- No Python Script task remains
- Flow passes YAML syntax validation
- Flow deploys to test Kestra instance without errors

---

## Phase 2: Mostly Declarative — triage_draft_alert.yaml

**Scope:** Replace Discord HTTP, GitHub creation, OpenAI drafting, and Qdrant CRUD with native plugins. Keep Python only if Qdrant scroll+structured payload proves impossible via HTTP.

**Current state:** Routes by `action` (draft/approve/approve_by_reaction). Each branch has inline Python doing Discord HTTP, Qdrant scroll/update, GitHub HTTP, OpenAI chat.

**New design:**

### "draft" branch:
1. **Task `fetch_cluster`** — `io.kestra.plugin.core.http.Request` → Qdrant scroll API POST `/collections/discord_unmatched/points/scroll`
   - Body: `filter` on `cluster_id`, `limit: 100`, `with_payload: true`
2. **Task `extract_summaries`** — `io.kestra.plugin.core.debug.Return` or `io.kestra.plugin.core.log.Log` to build prompt from scroll results using Pebble/JQ
3. **Task `draft_issue`** — `io.kestra.plugin.ai.completion.ChatCompletion`
   - Provider: `io.kestra.plugin.ai.provider.OpenAI` with `modelName: gpt-4o`, `apiKey: {{ secret('OPENAI_API_KEY') }}`
   - Messages: SYSTEM (draft GitHub issue from reports), USER (combined summaries)
4. **Task `parse_draft`** — `io.kestra.plugin.core.debug.Return` to extract title (first line) and body via Pebble string split
5. **Task `send_alert`** — `io.kestra.plugin.core.http.Request` → Discord POST `/channels/{id}/messages`
   - `headers`: `Authorization: Bot {{ secret('DISCORD_BOT_TOKEN') }}`
   - `body`: JSON with embed + components (buttons)
6. **Task `mark_alert_sent`** — `io.kestra.plugin.core.http.Request` → Qdrant PUT `/collections/discord_unmatched/points/payload`
   - Body: payload update with `alert_sent: true`, `draft_title`, `draft_body`

### "approve" / "approve_by_reaction" branch:
7. **Task `fetch_draft`** — `io.kestra.plugin.core.http.Request` → Qdrant scroll (limit 1) to get `draft_title`/`draft_body`
8. **Task `create_issue`** — `io.kestra.plugin.github.issues.Create`
   - `oauthToken`: `{{ secret('GITHUB_TOKEN') }}`
   - `repository`: `{{ kv('GITHUB_OWNER') }}/{{ kv('GITHUB_REPO') }}`
   - `title`: `{{ outputs.fetch_draft.body | json | jq('.result.points[0].payload.draft_title') }}`
   - `body`: `{{ outputs.fetch_draft.body | json | jq('.result.points[0].payload.draft_body') }}` + approver attribution
9. **Task `mark_created`** — `io.kestra.plugin.core.http.Request` → Qdrant payload update with `github_issue_number`, `github_issue_url`, `status: created`
10. **Task `delete_message`** (approve_by_reaction branch only) — `io.kestra.plugin.core.http.Request` → Discord DELETE `/channels/{id}/messages/{msg_id}`

**Acceptance criteria:**
- GitHub issue creation uses `io.kestra.plugin.github.issues.Create`
- OpenAI drafting uses `io.kestra.plugin.ai.completion.ChatCompletion`
- Discord API uses `io.kestra.plugin.core.http.Request`
- Qdrant operations use `io.kestra.plugin.core.http.Request`
- Flow passes YAML validation and deploys

---

## Phase 3: Hybrid Modernization — discord_triage.yaml

**Scope:** Replace Discord fetch, OpenAI summarization, and LLM judges with native plugins. Modernize Python for the Qdrant embed+search+upsert sequence.

**Current state:** A single large Python script fetching Discord, summarizing, embedding, searching Qdrant, running LLM judges, upserting, checking threshold.

**New design:**
1. **Task `fetch_messages`** — `io.kestra.plugin.core.http.Request` → Discord GET `/channels/{thread_id}/messages?limit=100`
   - `headers`: `Authorization: Bot {{ secret('DISCORD_BOT_TOKEN') }}`
2. **Task `build_report`** — `io.kestra.plugin.core.debug.Return` to combine thread name + first message + messages body into a single text using Pebble/JQ
3. **Task `summarize`** — `io.kestra.plugin.ai.completion.ChatCompletion`
   - Provider: OpenAI, model `minimax-m2.7`
   - Messages: system (summarize bug report), user (report text)
4. **Task `search_github`** — `io.kestra.plugin.core.http.Request` → Qdrant search API, OR a modernized Python script
   - **Decision:** Use modernized Python script because `rag.Search` does not return structured metadata (issue numbers, URLs). The native alternative would require: HTTP to OpenAI embeddings → parse 1536-dim vector → HTTP to Qdrant search → parse structured payloads. This is possible but brittle. A modernized Python script is maintainable.
   - Modernization: `dependencies: [openai, qdrant-client, requests, kestra]`, `taskRunner: io.kestra.plugin.core.runner.Process`, `containerImage: python:3.13-slim`
5. **Task `judge_a`** — `io.kestra.plugin.ai.completion.Classification`
   - Provider: OpenAI, model `minimax-m2.7`
   - `classes`: ["MATCH", "NO_MATCH"]
   - `prompt`: Summary + top GitHub candidates
6. **Task `route_match`** — `io.kestra.plugin.core.flow.If` on `{{ outputs.judge_a.classification == 'MATCH' }}`
   - Then: extract issue number from search results and return via `io.kestra.plugin.core.debug.Return`
7. **Task `search_memory`** — Modernized Python or HTTP (same tradeoff as step 4)
8. **Task `judge_b`** — `io.kestra.plugin.ai.completion.Classification`
   - `classes`: ["CLUSTER_EXISTING", "NEW_CLUSTER"]
9. **Task `upsert_and_check`** — Modernized Python script for embed + upsert + threshold count
   - This is the one operation truly impossible to do cleanly without Python (no standalone embedding task + need custom point metadata)

**Acceptance criteria:**
- Discord fetch uses `io.kestra.plugin.core.http.Request`
- Summarization uses `io.kestra.plugin.ai.completion.ChatCompletion`
- LLM judges use `io.kestra.plugin.ai.completion.Classification`
- All remaining Python scripts use `dependencies` and explicit `taskRunner`/`containerImage`
- Flow outputs are preserved (outcome, issue_number, cluster_id, summary, threshold_hit, point_id)
- Flow passes YAML validation and deploys

---

## Phase 4: Hybrid Modernization — github_sync_daily.yaml

**Scope:** Replace GitHub pagination with native GitHub plugin or HTTP Request. Modernize Python for embed+upsert loop.

**Current state:** Python script paginates GitHub issues API, filters PRs, computes embeddings for all issues, upserts to Qdrant.

**New design:**
1. **Task `fetch_issues`** — Native options:
   - **Option A:** `io.kestra.plugin.github.issues.Search` with `open: true`, `repository: owner/repo`, `fetchType: FETCH`
     - Limitation: GitHub search API has 1000 result limit and returns search API fields (different from repo issues API). May break if repo has >1000 open issues.
   - **Option B:** `io.kestra.plugin.core.http.Request` to `GET /repos/{owner}/{repo}/issues?state=open&per_page=100&page=1`, parse `Link` header or check empty response, loop via `ForEach` or keep Python for pagination
   - **Decision:** Use modernized Python for fetching because pagination logic (loop until empty, filter PRs) is complex declaratively. The GitHub search plugin has a 1000 limit and different response shape.
2. **Task `embed_and_upsert`** — Modernized Python script
   - `dependencies: [requests, openai, qdrant-client]`
   - Same logic as current but modernized syntax

**Wait — alternative:** Could we split fetch and embed declaratively?
- Use HTTP Request to fetch page 1 of issues
- Use `If` to check if results are empty
- If not empty, process via `ForEach`... but each issue needs embedding then upsert. The loop can't easily accumulate the full batch because each `ForEach` iteration would need to call OpenAI embeddings (expensive, rate-limited).

**Decision:** Keep a single modernized Python script for the entire fetch+embed+upsert pipeline. Replace `beforeCommands` with `dependencies`.

**Acceptance criteria:**
- Python script uses `dependencies` instead of `beforeCommands`
- Python script declares `taskRunner` and `containerImage`
- Flow passes YAML validation and deploys

---

## Phase 5: Validation and Smoke Test

**Scope:** Deploy all 4 updated flows to the test Kestra instance and verify they execute without plugin errors.

**Steps:**
1. Deploy all 4 flows to the test namespace
2. Trigger `memory_cleanup` manually (safe — count-only path first)
3. Verify `discord_triage` webhook trigger is registered
4. Verify `github_sync_daily` schedule trigger is registered
5. Verify `triage_draft_alert` can be triggered via subflow or manual run
6. Check execution logs for any "plugin not found" or class-loading errors

**Acceptance criteria:**
- All 4 flows deploy without errors
- No ``ClassNotFoundException`` for plugin types
- Manual trigger of `memory_cleanup` succeeds
- Schedule triggers are visible in UI

---

## Plugin Type Reference

| Operation | Current | New |
|-----------|---------|-----|
| HTTP GET/POST/PUT/DELETE | Python `requests` | `io.kestra.plugin.core.http.Request` |
| OpenAI chat | Python `openai` client | `io.kestra.plugin.ai.completion.ChatCompletion` |
| OpenAI embedding | Python `openai` client | `io.kestra.plugin.ai.provider.OpenAI` (embedded in RAG tasks) OR keep Python |
| LLM Judge | Python `openai` + text parsing | `io.kestra.plugin.ai.completion.Classification` |
| GitHub issue create | Python `requests` | `io.kestra.plugin.github.issues.Create` |
| GitHub issue search | Python `requests` | `io.kestra.plugin.github.issues.Search` (limited) OR keep Python |
| Qdrant search | Python `qdrant-client` | Keep Python (structured metadata) OR HTTP Request |
| Qdrant count/delete | Python `qdrant-client` | `io.kestra.plugin.core.http.Request` (Phase 1) |
| Qdrant scroll/upsert | Python `qdrant-client` | Keep Python OR HTTP Request |
| Python inline script | `beforeCommands` | `dependencies` + `taskRunner` + `containerImage` |
| Flow control | Python `if`/`for` | `io.kestra.plugin.core.flow.Switch`, `If`, `ForEach` |

---

## Build Chunks

**Chunk 1:** Phase 1 — `memory_cleanup.yaml` (single file, fully declarative)
**Chunk 2:** Phase 2 — `triage_draft_alert.yaml` (single file, mostly declarative)
**Chunk 3:** Phase 3 — `discord_triage.yaml` (single file, hybrid)
**Chunk 4:** Phase 4 — `github_sync_daily.yaml` (single file, hybrid)
**Chunk 5:** Phase 5 — Validation (deployment + smoke test)

Chunks 1, 2, 3, 4 can be built in parallel because they modify different files.
Chunk 5 is sequential.
