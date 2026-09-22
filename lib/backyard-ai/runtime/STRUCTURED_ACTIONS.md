# Backyard AI structured actions v1

This is an opt-in engineering controller, not an enabled LLM/provider integration or a new persistence store. It reuses the existing Spanish intent parser, canonical `RoundSetupDraft`, setup executor/validators, tee snapshots and round statistics. It does not send money, calculate wagers, send email, call an LLM or write to a database.

## Host integration

Import `createStructuredConversationController` from `lib/backyard-ai/runtime`. Supply the existing canonical draft, captured scores/putts, round lifecycle, authenticated owner ID, revision and persisted idempotency receipts. Supply only authorized public player identities, saved groups and real catalog cards. `host.principal()` must read the actual current Auth/edit/consent state; it must not read action arguments or provider text.

1. Call `conversation(text, requestId)` for deterministic Spanish parsing, or `preview(batch)` for a versioned structured response from any future provider. Neither call mutates round state. Unresolved names, courses, tees or unsupported grammar return clarification instead of a partially executable plan.
2. Display `preview.actions`, the canonical before/after draft and `preview.warnings`. A caller cannot alter a returned preview and have that alteration executed.
3. An explicit human confirmation calls `confirm(preview.token, { confirmed: true, acknowledgeImpact })`. Impact must be separately acknowledged for changes affecting captured scores/rules. The controller checks current Auth, edit access, consent and the entire original state again.
4. Persist the returned `state` (including receipts) **atomically through the existing host local-first round repository**, with compare-and-swap against the previously loaded revision. Feed the returned canonical `state.draft` into the same application draft adapter used by existing setup confirmation; no generated state patches are accepted. If host persistence fails/conflicts, reload the durable state and create a fresh controller; do not report success or reuse a pending token.
5. On any local, cloud or other-tab update call `refresh` with the trusted current state before further preview/confirmation. A cross-tab/repository revision remains necessary: an in-memory controller is not a distributed lock.
6. An explicit human Undo calls `undo(undo.token, true)`, then follows the same atomic persistence protocol. Undo restores only the immediately preceding controller mutation, advances the revision and retains receipts so a retry cannot reapply the undone request. Session reload intentionally discards preview/undo capabilities, not durable receipts.
7. `queryResults` must be wired by trusted application code to its existing deterministic Games Engine aggregation. There is no numeric LLM answer fallback. An absent adapter returns `DETERMINISTIC_ENGINE_ADAPTER_REQUIRED`; score-only does not invoke it. The tests bind the real `calculateSkins` engine and compare the returned object exactly. `query_statistics` uses existing captured-fact statistics code.

This controller does not weaken server authorization/RLS and must not itself be exposed as an unauthenticated RPC. The opaque confirmation capability is scoped to a controller instance and held in memory; it is not a server signature. No stable owner UI has been switched to this controller in the nightly foundation.

## Schema and current limits

`StructuredActionBatch` v1 has `requestId`, `expectedRevision` and 1–64 actions. Unknown versions/types/fields, prototype keys, non-finite values and unsupported handicap providers are rejected. The 21 requested action types are enumerated by `STRUCTURED_ACTION_TYPES`. Actions select trusted IDs; only explicit capture/configuration values enter the canonical validator. There is no arbitrary state/SQL/script/result patch.

Natural Spanish supports the owner example with resolved Carlos/Mike/Jorge identities, Nassau 500, 80% and mixed tees. Natural-language coverage is intentionally finite: ambiguous or advanced grammar asks for explicit selection. The existing setup UI/parser remains available for its wider established grammar. Explicit `configure_bet` supports existing core, group/individual Nassau, Polla components, Bola Amiga and existing supplemental configuration shapes; mathematics remains in the engine.

Course selection leaves tee selection unresolved. Each player's tee must be explicit before `start_round`; snapshots freeze catalog hole cards. No ratings, slopes or scores are inferred. Round HCP uses the existing domain range -15 through 36; inputs outside the range request clarification instead of the old parser's clamping behavior. Profile index requires profile evidence. GHIN and future providers are not activated.

Changing roster follows the existing setup reset behavior: a preview warns that bets must be reconfigured, and new players receive no invented tee. Captured players cannot be removed, and captured course/geometry cannot be changed through this foundation. Completed/cancelled rounds are read-only. `correct_score` explicitly warns that engine results will change; stale previews and missing acknowledgements are rejected.

Validation evidence: `tests/backyard-ai-structured-actions.test.ts` uses synthetic fixtures only, no external calls or real-user writes. It covers all 21 actions, the Spanish owner example, malformed/provider injection, authentication changes, consent revocation, stale revisions, confirmation tampering, concurrent-controller tokens, retries after reload/undo, captured score corrections, mixed tees, catalog immutability and real-engine delegation.
