# Experimental and Multiplayer settings

All fields use `izci.experimental-settings` /
`izci-experimental-settings`, normalize in `experimental-settings.ts`, are
presented by `ExperimentalView.svelte` except the two disk-cache fields also
presented by `CacheView.svelte`. Experimental page reset resets the full store,
including both Cache fields; Cache page reset updates only those two fields. Desktop Options
and mobile shared Options both expose them. Unit evidence is
`experimental-settings.test.ts`; Stage 1 scenarios are
`experimental-setting-runtime`, `settings-cross-window`, and the relevant
multi-profile Multiplayer scenario.

For every row, label, hint, choices and disabled state are the identity-specific
`$t('options.experimental.multiplayer...')` calls and adjacent control in
`ExperimentalView.svelte`; disk rows additionally use the identity-specific
`$t('options.cache...')` calls in `CacheView.svelte`.

The entire settings object is allowlisted in unencrypted `.izci` backups,
including `multiplayerTurnSecret`. That export/import policy is an explicit
security/product defect to resolve; it is not covered by “do not log secrets.”

| Identity | Default / choices or range | Presentation conditions | Exact runtime / apply | Disposition |
| --- | --- | --- | --- | --- |
| `multiplayer` | false; boolean | represented through mode selector | App/session feature gate; mode change | Preserve |
| `multiplayerFreeplay` | false; boolean | represented through mode selector | `deriveMultiplayerMode`; session role; mode change | Preserve; canonical persisted tier bit |
| `multiplayerStreamAudio` | true; boolean | represented through mode selector | `deriveMultiplayerMode`; hosted-audio pathway; mode change | Preserve; canonical persisted tier bit |
| mode selector | derived singleplayer/coop/coopAudio/freeplay | always | `multiplayerModePatch` writes all three tier booleans atomically | Preserve control; not a fourth stored field |
| `izciName` | random `Scout xxxx`; sanitized 1–48 chars | always rendered/enabled | session hello/host directory when Multiplayer applies; next/current session identity | Preserve |
| `multiplayerWaitForClients` | false; boolean | always rendered/enabled | host synchronized-start readiness when applicable; next start | Preserve |
| `multiplayerSynchronizedPlayback` | false; boolean | Co-op + audio mode only | host/client shared start; next transition | Preserve |
| `multiplayerSyncLeadTimeMs` | 1000; 250–3000 step 50 | Co-op + audio and synchronized playback enabled | host start scheduling; next transition | Preserve |
| `multiplayerAutoHost` | false; boolean | multiplayer enabled/host-capable | session startup; next app/session startup | Preserve |
| `multiplayerRestoreLastSession` | true; boolean | multiplayer enabled | session startup/reconnect; next startup | Preserve |
| `multiplayerTurnUrl` | empty; turn/turns URL, max 512 | always rendered/enabled | credential/signaling/ICE when configured; next peer connection | Preserve |
| `multiplayerTurnSecret` | empty; single line max 512 | always rendered/enabled | credential exchange when configured; next connection | Preserve secret; repair unencrypted backup inclusion |
| `multiplayerTurnCredentialHours` | 12; 1–48 integer | URL and secret present | TURN credential lifetime; next issuance | Preserve |
| `multiplayerForceTurn` | false; boolean | URL and secret present | ICE transport policy; next peer connection | Preserve |
| `multiplayerFileTransferLimitMiB` | 0; 0/1/2/4/8/16/32/64/-1 | hosted audio/freeplay | host delivery selector; next source; strict `<` finite boundary | Preserve exact semantics |
| `multiplayerOpusBitrateKbps` | 128; 32–160 step 8 | render-capable and not Every File | render/cache identity; next render | Preserve |
| `multiplayerAudioBufferMs` | 3000; 1000–30000 step 250 | render-capable | client startup/rebuffer window; current/next generation | Preserve |
| `multiplayerRenderCacheLimitMiB` | 256; 0/64/128/256/512 | render-capable | host memory cache via session/cache; immediate eviction policy/new render | Preserve; soft cap while pinned |
| `multiplayerRenderDiskCacheEnabled` | true; boolean | Cache page; effective only while Multiplayer render listener exists | client disk-cache service; immediate/new reads+writes | Preserve; not opt-in at field default, outer experiment defaults off |
| `multiplayerRenderDiskCacheLimitMiB` | 1024; 256/512/1024/2048/4096 | disk cache enabled | client disk cache; immediate eviction/new writes | Preserve |
| `multiplayerMaxListeners` | 4; 1–8 integer | always rendered/enabled | host admission when applicable; current/new joins | Preserve |

Experimental reset reaching disk-cache policy from a parent page is a scope
defect; Cache reset itself is correctly limited to its two fields. Cache remove-
entry/refresh/clear-all are action controls listed in `actions.md`, not settings.
