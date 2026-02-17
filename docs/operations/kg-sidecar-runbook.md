# KG Sidecar Runbook

Date: 2026-02-16

## 1. Preconditions

- SillyTavern root: `J:/SillyTavern`
- Node dependencies installed:
  - root: `npm install`
  - tests: `npm --prefix tests install`
- Optional Neo4j via Docker:
  - `docker run -d --name neo4j-mapped -p 7474:7474 -p 7687:7687 -e NEO4J_AUTH=neo4j/Neo4jPass_2026! neo4j:5`

## 2. Enable plugin

1. Start SillyTavern.
2. Open Extensions panel.
3. Enable `KG Sidecar`.
4. Configure:
   - `Graph Storage` = `memory` or `neo4j`
   - when `neo4j`, set URI / database / username / password.

## 3. API checks

- Health:
  - `GET /api/kg-sidecar/health/pipeline`
  - expected: `{ ok: true, status: "ready", service: "kg-sidecar" }`
- Commit:
  - `POST /api/kg-sidecar/turn/commit`
- Status:
  - `GET /api/kg-sidecar/turn/status/:turnId`
- Retry:
  - `POST /api/kg-sidecar/turn/retry`

## 4. Error code mapping

- `INVALID_REQUEST` -> HTTP 400
- `IN_PROGRESS` -> HTTP 409
- other rollback reasons -> HTTP 422

Common rollback reason codes:

- `IDENTITY_CONFLICT`
- `NEO4J_TX_FAILED`
- `TURN_NOT_FOUND` (retry endpoint)

## 5. Rollback semantics

- Rollback means sidecar returns `commit.status = ROLLED_BACK`.
- Frontend should treat rollback as unsynced turn.
- Retry only when `retryable = true`.

## 6. Neo4j verification snippets

Check event writes:

```cypher
MATCH (e:KGRelEvent)
RETURN count(e) AS event_count;
```

Check milestones:

```cypher
MATCH (m:KGMilestone)
RETURN m.turn_id, m.content
ORDER BY m.created_at DESC
LIMIT 10;
```

## 7. Test commands

- Sidecar test suite:
  - `npm --prefix tests run test:unit -- sidecar`
- Frontend extension unit-style check:
  - `npm --prefix tests run test:unit -- frontend/kg-sidecar.extension.test.js`
- Tests lint:
  - `npm --prefix tests run lint`

## 8. Real-network long-dialogue regression

Use this to run a real 20-turn regression against your running SillyTavern + KG sidecar + OpenRouter + Neo4j.

Command:

- `npm run kg:realnet:regression`

Common env overrides:

- `KG_SIDECAR_BASE_URL` (default: `http://127.0.0.1:8000/api/kg-sidecar`)
- `KG_SETTINGS_PATH` (default: `data/default-user/settings.json`, auto-loads kgSidecar db/models)
- `KG_REGRESSION_TURNS` (default: `20`)
- `KG_REGRESSION_MODEL` (default: `openrouter/auto`)
- `KG_REGRESSION_TIMEOUT_MS` (default: auto-derived, at least `120000`)
- `KG_REGRESSION_CLEAR_BEFORE` (`true`/`false`, default: `true`)
- `KG_REGRESSION_RETRYABLE_RETRIES` (default: `2`, only for `retryable=true` rollbacks)
- `KG_DB_PROVIDER` / `KG_DB_URI` / `KG_DB_DATABASE` / `KG_DB_USERNAME` / `KG_DB_PASSWORD`

Outputs:

- JSON report saved to `output/kg-sidecar-realnet-regression-*.json`
- Runner fails with non-zero exit code when any gate fails:
  - commit ratio below target
  - missing replace milestone
  - missing `ZUENS2020` recall signal
  - timeout observed

Notes:

- Runner auto-handshakes SillyTavern CSRF (`/csrf-token`) and session cookie before API calls.
