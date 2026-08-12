# Goldilocks setting ledger

The authoritative field-level ledger and non-setting action inventory live in
[`settings-ledger/`](settings-ledger/README.md). It records presentation source,
default/range/choices, storage/channel/reset, exact runtime consumer and apply
timing, evidence/gaps, and disposition for:

- all shared Main/Mobile Options fields;
- every Raf rack/effect/preset/transfer control;
- every Experimental and Multiplayer field;
- every Converter, Logs, and Troubadour setting;
- other user-controlled persisted state such as volume, workspace, Library,
  loadouts, popup state, and Multiplayer resume/pairing state;
- Options and tool commands that are controls but not persisted settings.

No row is removable merely because its consumer is absent. Current disconnected
or ambiguous fields default to **repair**.

## Cross-cutting defects frozen at Stage 0

1. `persistent-store.ts` has no causal origin/message IDs, deterministic
   simultaneous-write ordering, removal handling, write/post failure state, or
   dispose path. Whole-object last-writer-wins can discard unrelated edits.
2. Appearance/Backdrops/Now Playing/Lyrics page resets all reset the entire
   appearance store; Experimental reset also reaches the Cache child settings,
   while Cache reset correctly changes only those two fields. Locale is
   shown in Appearance but omitted from Appearance reset. Video reset changes
   menu-only `fitMode`.
3. Player volume receives generic cross-window store updates, but the active
   player controller does not subscribe, so remote-window changes do not reach
   runtime audio until reconstruction/new local input.
4. Converter settings are an unsynchronized localStorage island with swallowed
   writes and no reset control.
5. Twelve visible Troubadour settings lack a runtime consumer:
   `multiValueDisplay`, `dateDisplay`, `albumEditPolicy`, `reorderRenumber`,
   `validationSeverity`, `albumArtworkDefault`, `enableFolderTemplates`,
   `backupPolicy`, `postWriteVerification`, `writeConcurrency`,
   `externalChangeBehavior`, and `batchErrorBehavior`.
6. Troubadour's `largeFileThresholdMb` and `diagnosticJobReporting` are persisted
   but have no presentation, runtime consumer, or page-reset membership.
7. The backup allowlist names Library view v5 while live state is v6. The entire
   Experimental settings object is backed up unencrypted, including the TURN
   shared secret; both are explicit product/security defects.
8. Multiplayer mode is three canonical persisted booleans plus one derived UI
   selector, not a single enum. Disk cache defaults true inside an experiment
   that defaults off. Host memory and client disk cache settings have distinct
   owners and apply boundaries.
9. Current Freeplay resume state stores one last-host record, not one independent
   record per pair as desired.
10. Settings/tests are implicit rather than registry-checked. Stage 1 adds a
    reporter that compares declared store fields, presentation/control sources,
    runtime references, and ledger identities; omissions initially report and
    become errors by reconstructed domain.

Passing normalization tests alone does not prove a setting is connected.
Stage 1 evidence must change each `gap` into a named deterministic contract,
browser scenario, or honest manual/device residual.
