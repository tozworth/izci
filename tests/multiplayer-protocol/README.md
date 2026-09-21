# Multiplayer application-protocol fixtures

Canonical valid/invalid JSON plus binary source/render frames for the izci
Multiplayer data-channel protocol. The normative specification lives in
`docs/izci-server-protocol.md`; wire definitions live in code
(`src/lib/services/multiplayer-protocol.ts`, `sidekick/internal/protocol/`).
Both stacks consume these files.

- `valid-*.json` must be accepted (or safely ignored for unknown optional kinds).
- `invalid-*.json` must be rejected.
- `frames/valid-*.bin` must decode; `frames/invalid-*.bin` must fail.
- `transcripts/*.json` are stateful conformance transcripts validated for
  ordering and generation ownership, not only decoding.
