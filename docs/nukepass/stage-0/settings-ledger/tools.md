# Tool-specific settings

## Converter

All Converter rows use direct unsynchronized localStorage key
`izci:converter-settings`, normalization in `converter-options.ts`, presentation
in `ConverterApp.svelte`, and runtime in `converter-engine.ts` /
`converter.worker.ts` for the next job. All controls are disabled while busy.
Writes are swallowed on storage failure; there is no reset, BroadcastChannel, or
storage-event handling. Unit evidence is `converter-options.test.ts` plus focused
engine/output tests; Stage 1 scenarios are `converter-setting-runtime`,
`converter-persistence-failure`, and early/mid/late cancellation.

For every row, label/hint/unit text and exact show/disable expression are the
identity-specific `$t('converter.options...')` call and adjacent control in
`ConverterApp.svelte`; the table records the semantic condition. Converter is a
desktop tool and intentionally absent from mobile navigation.

| Identity | Default / choices or range | Presentation condition | Disposition |
| --- | --- | --- | --- |
| `format` | flac; every `CONVERTER_FORMATS` ID | always | Preserve |
| `audioCodec` | aac; format-supported codecs | selector rendered only for video formats | Preserve |
| `audioBitrateKbps` | 192; 6–1024 | `isLossyAudio` | Preserve |
| `audioBitrateMode` | variable; constant/variable | `isLossyAudio` | Preserve |
| `sampleRate` | source; source/22050/32000/44100/48000/88200/96000 | effective audio codec not none; Opus rendered but locked to 48 kHz | Preserve |
| `channels` | source; source/1/2 | effective audio codec not none | Preserve |
| `pcmFormat` | s16; u8/s16/s24/s32/f32/f64 | WAV | Preserve |
| `flacBitDepth` | 24; 16/24 | FLAC | Preserve |
| `videoCodec` | avc; format-supported video codecs | every video format | Preserve |
| `videoBitrateMbps` | 8; .1–500 | every video format | Preserve |
| `videoBitrateMode` | variable; constant/variable | every video format | Preserve |
| `videoSize` | source; source/3840x2160/2560x1440/1920x1080/1280x720/854x480 | every video format | Preserve |
| `videoFit` | contain; contain/cover/fill | video format and size not source | Preserve |
| `frameRate` | source; source/24/25/30/50/60 | every video format | Preserve |
| `rotate` | 0; 0/90/180/270 | every video format | Preserve |
| `allowRotationMetadata` | true; boolean | every video format | Preserve |
| `alpha` | discard; discard/keep | every video format; effective capability may constrain | Preserve |
| `keyFrameInterval` | 5; 0–60 seconds | every video format | Preserve |
| `hardwareAcceleration` | no-preference; no-preference/prefer-hardware/prefer-software | every video format | Preserve |
| `fastStart` | in-memory; off/in-memory/fragmented | MP4/MOV-style containers | Preserve |
| `fragmentDuration` | 1; 0–60 seconds | fragmented container mode | Preserve |
| `wavLargeFile` | false; boolean | WAV | Preserve |
| `wavMetadata` | id3; info/id3 | WAV regardless of preserveMetadata | Preserve |
| `mp3XingHeader` | true; boolean | MP3 | Preserve |
| `oggPageDuration` | 1; .05–60 seconds | Ogg | Preserve |
| `matroskaClusterDuration` | 1; 0–60 seconds | Matroska/WebM | Preserve |
| `trackSelection` | primary; primary/all | every video format; multi-track input controls runtime relevance | Preserve |
| `preserveMetadata` | true; boolean | always | Preserve; covers copied tags/artwork, no separate artwork field |
| `fileSuffix` | empty; string max 80 and filename-sanitized at output | always | Preserve |
| `preserveFolders` | true; boolean | always rendered | Preserve |
| `skipExisting` | true; boolean | always rendered | Preserve |
| `parallelism` | 2; 1–8 integer | always | Preserve as bounded worker concurrency |

Codec/format support can disable otherwise valid normalized choices at runtime;
the effective codec helpers and browser capability checks are part of each row's
contract.

## Logs

Logs settings use the common synchronized engine and are presented by
`LogsApp.svelte`/`LogsMenuBar.svelte`. There is no combined reset UI. Stage 1
scenario is `logs-setting-runtime`.

| Identity | Persistence | Default / choices | Runtime/evidence | Disposition |
| --- | --- | --- | --- | --- |
| `captureDebug` | `izci.logging-settings.v1` / `izci-logging-settings-v1` | false; boolean | `logging.ts`; normalization test gap | Preserve |
| `mirrorToConsole` | same | false; boolean | `logging.ts`; test gap | Preserve |
| level visibility `error` | `izci.logs-levels.v2` / hyphenated v2 channel | true; boolean | Logs projection; test gap | Preserve |
| level visibility `warning` | same | true; boolean | same | Preserve |
| level visibility `info` | same | true; boolean | same | Preserve |
| level visibility `debug` | same | false; boolean | same | Preserve |
| width `time` | `izci.logs-column-widths.v2` / `izci-logs-column-widths-v2` | 104; minimum 64 | Logs table; `logs-columns.test.ts` | Preserve |
| width `level` | same | 64; minimum 44 | same | Preserve |
| width `source` | same | 92; minimum 48 | same | Preserve |
| width `context` | same | 108; minimum 52 | same | Preserve |
| width `message` | same | 240; minimum 100 | same | Preserve |
| width `details` | same | 240; minimum 100 | same | Preserve |
| visibility `time` | `izci.logs-column-visibility.v2` / `izci-logs-column-visibility-v2` | true | Logs table; `logs-columns.test.ts` | Preserve |
| visibility `level` | same | true | same | Preserve |
| visibility `source` | same | true | same | Preserve |
| visibility `context` | same | true | same | Preserve |
| visibility `message` | same | true | same | Preserve |
| visibility `details` | same | true | same | Preserve |
| sort `columnId` | `izci.logs-sort.v2` / matching channel | time; six columns | Logs projection; `logs-columns.test.ts` | Preserve |
| sort `direction` | same | asc; asc/desc | Logs projection | Preserve |
| auto-scroll | transient session control | current UI default | Logs presentation only | Preserve transient; never persist |

Visibility normalization restores Time if every column is false. Width fitting
may temporarily scale below declared minima only to fit an undersized viewport;
stored normalization preserves the minima.

## Troubadour

All rows use `izci.troubadour-settings` / same channel, normalization in
`troubadour-settings.ts`, presentation in
`TroubadourSettingsPage.svelte`, and page-key reset in
`TroubadourOptionsApp.svelte`. Desktop-only tool Options (tools remain hidden on
mobile). Unit source is `troubadour-settings.test.ts`; Stage 1 scenarios are
`troubadour-setting-runtime` and `troubadour-options-reset`.

For every row, label/hint/choice text and advanced state are the identity-
specific `$t('troubadour.options...')` calls and adjacent control in
`TroubadourSettingsPage.svelte`; the Page column supplies category/exposure.

| Identity / page | Default / choices or range | Current runtime / apply | Disposition |
| --- | --- | --- | --- |
| `initialLoad` / General | current-selection; current-track/current-selection/nothing | workbench initial handoff | Preserve |
| `folderScanDepth` / General | 12; 0–64 integer | next folder load | Preserve |
| `metadataReadConcurrency` / General | 4; 1–12 integer | next load job | Preserve |
| `autoGroupOnLoad` / General | true; boolean | next load | Preserve |
| `autoGroupFallback` / General | folder; folder/none | next grouping | Preserve |
| `confirmDirtyRemoval` / General | true; boolean | next dirty removal | Preserve |
| `visibleMetadataFields` / Metadata | all 21 declared fields; nonempty ordered subset | workbench field projection | Preserve |
| `multiValueDisplay` / Metadata | joined; joined/first/count | no runtime consumer | Repair connection |
| `dateDisplay` / Metadata | verbatim; verbatim/year/localized | no runtime consumer | Repair connection |
| `albumEditPolicy` / Metadata | ask; all-writable/supported-only/ask | no runtime consumer | Repair connection |
| `reorderRenumber` / Metadata | offer; never/offer/always | no runtime consumer | Repair connection |
| `rawTagVisibility` / Metadata | advanced; hidden/advanced/always | workbench raw-tag projection | Preserve |
| `validationSeverity` / Metadata | warnings; errors/warnings/all | no runtime consumer | Repair connection |
| `defaultArtworkKind` / Artwork | front; front/back/other | next artwork add | Preserve |
| `artworkSizeWarningMb` / Artwork | 8; 1–256 integer | artwork preflight | Preserve |
| `artworkDimensionWarningPx` / Artwork | 4000; 256–32768 integer | artwork preflight | Preserve |
| `multipleImageBehavior` / Artwork | preserve; preserve/replace-kind/reject | artwork edit/write | Preserve |
| `albumArtworkDefault` / Artwork | ask; selected/album/ask | no runtime consumer | Repair connection |
| `artworkPreviewFit` / Artwork | contain; contain/cover/actual | workbench preview; immediate | Preserve |
| `renameTemplate` / Rename | `{track:02} - {title}`; nonempty string | next preview/job | Preserve |
| `illegalCharacterReplacement` / Rename | `_`; normalized replacement string | next preview/job | Preserve |
| `normalizeWhitespace` / Rename | true; boolean | next preview/job | Preserve |
| `unicodeNormalization` / Rename | preserve; preserve/nfc/ascii | next preview/job | Preserve |
| `extensionCase` / Rename | preserve; preserve/lower/upper | next preview/job | Preserve |
| `missingTokenPolicy` / Rename | stop; stop/empty/skip | next preview/job | Preserve |
| `collisionPolicy` / Rename | stop; stop/skip/counter | next preview/job | Preserve |
| `enableFolderTemplates` / Rename | false; boolean | no runtime consumer | Repair connection |
| `copyVerification` / Rename | metadata; size/metadata/hash | next cross-directory rename | Preserve |
| `backupPolicy` / Files | none; none/sibling/backup-folder | no runtime consumer | Repair connection |
| `postWriteVerification` / Files | managed-fields; managed-fields/full-metadata | no runtime consumer | Repair connection |
| `writeConcurrency` / Files | 1; 1–4 integer | no runtime consumer | Repair connection |
| `externalChangeBehavior` / Files | stop; stop/reload-unchanged | no runtime consumer | Repair connection |
| `batchErrorBehavior` / Files | continue; continue/stop | no runtime consumer | Repair connection |
| `destructiveClearConfirmationThreshold` / Files | 5; 1–1000 integer | workbench destructive clear | Preserve |
| `largeFileThresholdMb` / no page | 512; 64–16384 integer | no UI, reset membership, or runtime consumer | Repair orphan field/product decision |
| `diagnosticJobReporting` / no page | false; boolean | no UI, reset membership, or runtime consumer | Repair orphan field/product decision |

Troubadour workspace layout is separate in `other-state.md`; its reset action is
in `actions.md`.
