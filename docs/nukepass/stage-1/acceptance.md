# Stage 1 acceptance candidate

The Stage 1 acceptance candidate was first exercised against source commit
`8d0c6a0e6908324128d3fc27b0440e36fb5674bc` on branch `nukepass`. The
pre-nukepass recovery oracle remains `nukepass-oracle-2026-08-12` at `33a7ca8`;
the Stage 0 handoff remains `57361c0`.

## Gate results

| Gate | Result | Final evidence |
| --- | --- | --- |
| `npm test` | pass | 143 files; 690 passed, 7 skipped; 697 total |
| `npm run test:coverage` | pass | whole-production baseline: 27.79% statements, 26.25% branches, 30.64% functions, 29.09% lines |
| `npm run check` | pass | 0 errors and 0 warnings |
| `npm run i18n:validate` | pass | English/Turkish catalogs current; Askew untouched |
| `npm run multiplayer:protocol:check` | pass | protocol 18 and Firebase rules synchronized |
| `npm run test:firebase-rules` | pass | all 8 rules tests under the Database emulator |
| fixture manifest/generator | pass | 21 deterministic files; 19 facts verified, 2 rejected as intended |
| `npm run test:nukepass-tools` | pass | 16 reporter/CDP Node tests |
| `npm run build` | pass | 600 modules; 91 Workbox entries / 7846.38 KiB |
| architecture reporter | pass | deterministic informational report; facts below |
| CDP acceptance | pass | all eight pages, three isolated profiles, two-window capability, application heaps, no background-runtime failure |

The seven ordinary-suite skips are the guarded Firebase rules cases; the
dedicated emulator command executes all eight. The known Firebase Tools
transitive `punycode` deprecation and Vite's chunks-over-500-kB warning remain
the only accepted command warnings.

## Characterization spine

| Boundary | Executable evidence | Frozen observation |
| --- | --- | --- |
| Playback command replacement | `playback-commands.test.ts` | A/B/C materialization and resume results are generation-authoritative; ended navigation remains suppressed while a manual transition is pending |
| Backend transitions | `player-controller.characterization.test.ts`, `howler-player.test.ts`, audio-bus/backend tests | A/B/C supersession, failed preparation, no/fadeout/crossfade decisions, command activity during load/preparation, the 4×4 stream/OpenMPT/Hively/video switch matrix, native-volume adoption fallback, ReplayGain/master gain, video Auto Amp bypass, and stale callback isolation |
| Hydration and queued mutation | `playlist-hydration.characterization.test.ts` | delayed stored state applies before queued add/rating/selection and the combined state persists |
| Permissions and reconciliation | `playlist-materialization.test.ts`, `filesystem-folders.test.ts`, `playlist-folder-reconciliation.test.ts` | granted/prompt/denied/unavailable behavior, bounded probes, stable identity/play count, changed files, scoped deletion, adoption/re-adoption |
| Cross-window collision | `persistent-store.test.ts` | duplicate BroadcastChannel/storage delivery is suppressed; simultaneous whole-object writers can diverge, preserved as a repair defect |
| PWA decisions | `pwa-updates.test.ts` | offline deferral, waiting/installing paths, update failure timestamp policy, apply/reload decisions, and online retry |
| Tool cancellation | Converter engine and Troubadour rename tests | pre/mid/late abort behavior, worker termination, stale completion suppression, partial destination cleanup, and the current late-rename commit behavior |
| Multiplayer generation | client-transition and session tests | bitrate/file-policy resync, reset ownership release, immutable delivery dedup/readiness, and late-source generation rejection |

The expanded transition matrix exposed and repaired one isolated prerequisite
defect: direct video loads now apply the same Auto Amp-only bypass already used
by prepared video commits. No playback path or format policy was replaced.

## Fixture contract

`fixtures/manifest.json` has SHA-256
`fd59ed6afb3eb65ef821432e94043e5d77145724951e1165b24407d61f5da71b`.
Generation is fail-closed against the recorded Node/FFmpeg/FFprobe toolchain and
validates digests, media/container facts, revision frequencies, tags/front
cover, plain/LRC structure, MOD headers/libopenmpt probing, and intended corrupt
or unsupported rejection. Manifest and logical-corpus tests remain runnable on
a clean install; the encoded-media integration test reports an intentional
named skip when the exact pinned media toolchain is unavailable.

The required format gaps remain explicit, not counterfeit coverage: XM, S3M,
IT, MO3, AHX, and HVL have no pinned tiny permissive generator/source in this
stage. M4V and MOV are format-policy coverage rather than duplicate binaries.

## Architecture, coverage, and bundle baseline

The final deterministic architecture report has SHA-256
`0a12a78b57d52b36965d5421f8f153eea0c12796acabf2d7ff4e46da633c4281`.
It reports 469 modules (458 browser, 5 worker, 4 vendor, 2 Node-build), 1,369
internal and 390 external edges, 24 unresolved relative asset edges, 232
direction findings (229 production, 3 test), and zero strongly connected
cycles. Browser/worker capability inspection records 406 observations and 386
applicable findings across 185 files; vendor and Node-build observations are
separated rather than treated as browser violations.

Dead-code probes conservatively report 315 possibly unreferenced exports and
three production modules with no production inbound edge:
`NonComponentMessages.svelte`, test-only `test-audio-context.ts`, and
`tag-container-audio.ts`. These are investigation inputs, not deletion proof.
Direction, capability, and dead-code findings are informational until their
owners are reconstructed and ratchets are introduced.

The production bundle contains 91 files / 8,057,315 bytes and 91 precache
entries. Largest JavaScript is the emitted libopenmpt worklet (1,774,814 B),
Converter worker (1,222,305 B), main chunk (563,270 B), and Multiplayer render
worker (545,350 B). Whole-source coverage explicitly counts untouched Svelte,
TypeScript, Sites Worker, and the owned Raf worklet as zero; vendored runtime is
excluded.

## Browser evidence

The final CDP report has SHA-256
`c064f9fe1c0bf2cffae01ebeb6192c9eefc5997a5b246cf996ba6673c0c624cd`.
It binds build
`ba67c05e491cf0feb8c8a8015add610c489c96554855d89150d06ece2470e3e9`
to clean commit `8d0c6a0`, Helium `Chrome/151.0.7922.71`, seed
`stage-1-final`, and three disposable profiles. Main, Options, Audio Compare,
Editor, Converter, Logs, Troubadour, and Troubadour Options all passed their
production lifecycle readiness marker with no page or attached izci
service-worker/worker/worklet exception, console error, HTTP error, target loss,
unexpected navigation, served-service-worker mismatch, trace failure, or heap
capture failure.

Each page has a screenshot, DOM snapshot, structured page result, and full V8
heap from that application target; each profile has a trace and process facts.
Reports are ignored runtime artifacts under `artifacts/`, not source-controlled
goldens. Infrastructure failures also emit `report.json`, and dirty or
commit-mismatched builds are deliberately rejected.

The Stage 1 boot catalog records the fixture-manifest digest but honestly marks
the corpus unused. Seeded old-active-service-worker updates, offline reloads,
media interaction, update acceptance, and fixture-handle injection expand the
harness in later stages rather than being inferred from page boot.

## Residual manual/device and later-stage work

- Native picker prompts, Launch Queue/file handlers, installed-PWA launch,
  Window Controls Overlay, popup/window-manager behavior, Android/mobile input,
  physical audio, and real TURN/network paths remain device/manual residuals.
- CDP proves production page boot, served worker identity, settled fresh-profile
  registration, and owned background-runtime output. It does not claim to hash
  private bytes of an already-active old worker; the seeded update matrix is a
  later PWA scenario.
- Real-browser fixture playback, AudioContext graph energy, repeated teardown
  counters, offline/update matrices, settings interaction matrices, and
  long-duration resource/leak loops grow on this spine in their owning stages.
- Existing defects recorded by the Stage 0 ledgers remain visible: setting
  last-writer divergence, broad reset scopes, disconnected Troubadour settings,
  incomplete singleton disposal, unbounded caches, and resource owners without
  central counters. Stage 1 freezes or reports them; it does not pre-empt the
  Stage 2 ownership kernel or later domain reconstruction.

## Candidate decision

The Stage 1 gate is ready for the clean assembled-tree rerun: a clean install is reproducible, required
behavioral boundaries have executable contracts, architecture/coverage/bundle
facts are durable and deterministic, fixtures are provenance-checked, and the
checked-in CDP harness reliably launches and records every production page with
fail-closed build and runtime evidence. Stage 2 begins only after the assembled
tree rerun and settings-ledger result are appended to this record.
