export const IDLE_PLAYER_QUIPS = [
  'scout',
  'xmplayRam',
  'interpolation',
  'lrcMsn',
  'fourChannels',
  'diskTwo',
  'playsThat',
  'opusEyes',
  'velocidensity',
  'santaFlac',
  'stereoMind',
  'offlineAmiga',
  'youtubeRips',
  'winampPlugins',
  'goldPlatedEars',
  'pronunciation',
  'losslessSilence',
  'llama',
  'patternZero',
  'whatPwa',
  'worksOnMachine',
] as const;

export type IdlePlayerQuipId = (typeof IDLE_PLAYER_QUIPS)[number];

export function pickIdlePlayerQuip(random = Math.random): IdlePlayerQuipId {
  const index = Math.floor(random() * IDLE_PLAYER_QUIPS.length);
  return IDLE_PLAYER_QUIPS[Math.min(Math.max(index, 0), IDLE_PLAYER_QUIPS.length - 1)];
}

export const sessionIdlePlayerQuip = pickIdlePlayerQuip();
