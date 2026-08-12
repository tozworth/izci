# Stage 0 acceptance

Stage 0 was accepted on 2026-08-12 on branch `nukepass`. The immutable recovery
point is annotated tag `nukepass-oracle-2026-08-12` at `33a7ca8`; the branch
checkpoint and inventories were committed as the following reviewable slices:

| Commit | Invariant |
| --- | --- |
| `33a60ea` | recovery checkpoint, commit/fixture policies, and risk register |
| `17b6598` | dependency/ownership map and playback conformance baseline |
| `f7e3cf0` | persistence and browser-resource ownership |
| `ad87506` | entrypoint/PWA/build and Multiplayer checkpoint ledgers |
| `fd50618` | capability, control, and field-level Goldilocks ledgers |

Three independent read-only surveys covered capability/settings presentation,
persistence/browser resources, and build/playback/Multiplayer. Each survey then
re-reviewed the assembled ledgers. Their factual corrections were applied before
this gate: exact defaults and conditional exposure, current reset behavior,
live storage/channel names, resource acquisition/disposal owners, tool controls,
delivery-specific Multiplayer authority, production assets, and known defects.

The settings ledger treats the identity-specific adjacent `$t(...)` call and
named Svelte view as the exact label/hint source rather than copying localized
English and Turkish strings into every row. Stage 1 adds a reporter to compare
those cited controls and store identities mechanically. This citation convention
does not weaken the rule that disconnected fields default to repair, not removal.

Stage 0 changed documentation only, so the project rule does not require a build
at this gate. Stage 1 begins with a clean-install baseline before adding the
verification spine.
