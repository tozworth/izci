# Multiplayer sidekick contract fixtures

Representative socket messages for the sidekick signaling protocol. The
definitions live in code (`sidekick/internal/server/protocol.go`); these files
are examples only. Phase 3 browser transport helpers validate against the same
fixtures.

Each file is one exact socket frame: `version`, `type`, `requestId`, optional
`attemptId`, and `payload`. Files starting with `valid-` must be accepted;
files starting with `invalid-` must be rejected.
