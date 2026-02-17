# KG Sidecar Runtime Architecture

Date: 2026-02-16  
Scope: SillyTavern local extension + local sidecar pipeline

## 1. Request entry

- Frontend extension sends `POST /api/kg-sidecar/turn/commit`.
- Request body is validated by `validateTurnCommitRequest`.
- Runtime key:
  - idempotency key: `conversation_id:turn_id`
  - lock key: `conversation_id`

## 2. Six-slot pipeline

Execution order in `TurnOrchestrator`:

1. `Retriever` (`slots/retriever.js`)  
2. `Injector` (`slots/injector.js`)  
3. `Actor` (`slots/actor.js`)  
4. `Extractor` (`slots/extractor.js`)  
5. `Judge` (`slots/judge.js`)  
6. `Historian` (`slots/historian.js`)  

State machine timeline:

`RECEIVED -> RETRIEVING -> INJECTING -> ACTING -> EXTRACTING -> JUDGING -> HISTORIANING -> PREPARED -> COMMITTING -> COMMITTED`

Any stage failure returns `ROLLED_BACK`.

## 3. Commit gate and rollback

- Commit gate: `graph/commitGate.js`
  - blocks when `actions` empty
  - blocks when judge has `identity_conflicts`
- Rollback behavior:
  - Before graph write: return rollback object only.
  - During graph write: transaction returns `committed: false`, orchestrator returns `ROLLED_BACK`.
  - No partial write is accepted as committed state.

## 4. Storage abstraction

Repository selection via `GraphRepositoryFactory`:

- `neo4j` provider only: `Neo4jGraphRepository` (transactional writes)

Neo4j writes:

- relation edge (`KG_REL`)
- event log (`KGRelEvent`)
- bio patch (`KGEntity.bio*`)
- milestone (`KGMilestone`)

## 5. Model routing

- Slot-model routing is defined in `model/modelRouter.js`.
- Default six-slot model identifiers exist for:
  - `retriever`, `injector`, `actor`, `extractor`, `judge`, `historian`
- Frontend can send overrides in `config.models.<slot>`.

## 6. Frontend bridge

Extension path: `public/scripts/extensions/kg-sidecar/`

- Generates per-turn payload from chat window.
- Sends Neo4j DB config in `config.db`.
- Applies returned `injection_packet` to extension prompt.
- Renders status badge (`idle`, `syncing`, `committed`, `rollback`, `error`).

## 7. Realnet regression harness

- Regression evaluator module: `src/sidecar/kg/regression/longDialogueRegression.js`
- Real-network runner: `scripts/kg-sidecar-realnet-regression.js`
- Purpose:
  - run multi-turn (default 20 turns) real API regression
  - enforce commit/rollback/timeout gates
  - verify relation mutation signals and milestone presence
