/**
 * Explicit temporary compatibility bridges for the A2 Svelte adoption.
 *
 * The MVP keeps two shell-side bridges outside the migrated libzci domain
 * authority (see `docs/libzci/phases.md` A2 and `validation.md` MVP gate):
 *
 * - Video stays on the native `<video>` path (`VideoPlayerService` plus
 *   `audioBusService.connectHtmlMediaElement` fallback). Core video (M5) is
 *   out of scope; the single-element ownership and PiP guard live here.
 * - Raf stays shell-side (`audioBusService` + `raf-engine` + `rafSettings`).
 *   The only core-adjacent policy is the `auto-amp` video bypass owned by
 *   `player-controller`. Full rack/loadout/gapless parity is M4 backlog.
 *
 * Playback-rate and normalization gaps are logged once as explicit warnings
 * by the stream/module services; this module pins the list so future slices
 * cannot silently widen it.
 */

/** Native video bridge: presentation-owned element, never a core transport. */
export const VIDEO_BRIDGE = {
  kind: 'native-video-element',
  service: 'VideoPlayerService',
  audioRoute: 'audioBusService.connectHtmlMediaElement',
  coreVideoScope: 'deferred-m5',
  ownership: 'single-element-with-pip-guard'
} as const;

/** Temporary Raf bridge: shell-side graph, explicit video bypass. */
export const RAF_BRIDGE = {
  kind: 'shell-raf-graph',
  graph: 'audioBusService + raf-engine + rafSettings',
  bypass: 'auto-amp bypass for video tracks',
  coreScope: 'deferred-m4',
  telemetry: 'raf-auto-amp-meter is presentation state, never persisted'
} as const;

/**
 * Known playback gaps that remain warnings, not silent behavior changes.
 * Each entry names the service, setting, and one-time log it emits.
 */
export const PLAYBACK_GAPS = [
  {
    service: 'LibzciStreamPlayerService',
    setting: 'playbackRate != 1',
    log: 'libzci stream speed is not adopted yet'
  },
  {
    service: 'LibzciModulePlayerService',
    setting: 'stereoSeparation/panStrength',
    log: 'libzci module stereo separation is not adopted yet'
  },
  {
    service: 'LibzciModulePlayerService',
    setting: 'Hively tempoFactor/pitchFactor',
    log: 'libzci Hively tempo/pitch is not adopted yet'
  },
  {
    service: 'LibzciModulePlayerService',
    setting: 'Hively repeatCount != 0',
    log: 'libzci Hively repeat is not adopted yet'
  },
  {
    service: 'LibzciStreamPlayerService',
    setting: 'ReplayGain via shared bus local gain',
    log: 'shell bridge until metadata normalization moves into the queue/library slice'
  }
] as const;

export type PlaybackGap = (typeof PLAYBACK_GAPS)[number];

/** Consumer contract that queue adoption must preserve (observation-only). */
export const CONSUMER_CONTRACT = {
  workspaceContent: 'WorkspaceTabContentProps.content',
  odaHost: 'OdaMediaHost + OdaCommands',
  mediaElements: 'mediaElementsStore.video',
  snapshot: 'playbackSnapshot'
} as const;
