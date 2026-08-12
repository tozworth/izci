# Nukepass execution record

This directory contains the maintained program artifacts required by
[`docs/nukepass.md`](../nukepass.md). The runbook is the policy; these files are
the source-backed record of what was actually frozen, surveyed, tested, and
accepted.

## Checkpoints

- [Stage 0 checkpoint](stage-0/checkpoint.md)
- [Commit policy](stage-0/commit-policy.md)
- [Fixture and test-data policy](stage-0/fixture-policy.md)
- [Risk register](stage-0/risk-register.md)
- [Stage 0 acceptance](stage-0/acceptance.md)
- [Capability and UX ledger](stage-0/capability-ux-ledger.md)
- [Goldilocks setting ledger](stage-0/goldilocks-setting-ledger.md)
- [Persistence registry](stage-0/persistence-registry.md)
- [Browser resource ledger](stage-0/browser-resource-ledger.md)
- [Entrypoint and asset registry](stage-0/entrypoint-asset-registry.md)
- [Dependency and ownership map](stage-0/dependency-ownership.md)
- [Playback conformance baseline](stage-0/playback-conformance.md)
- [Multiplayer checkpoint ledger](stage-0/multiplayer-ledger.md)

Inventories and verification evidence are updated in place as later stages
replace owners. A ledger row describes the current tree at its recorded commit;
it is not permission to retain an obsolete owner after its cutover stage.
