export const IDLE_PLAYER_QUIPS = [
  'İzci means scout. Tracker was already taken.',
  'What if XMPlay used 9 GB of RAM?',
  'REAL modheads turn interpolation OFF',
  'Time-synced LRC display! (MSN integration coming soon.)',
  'Four channels ought to be enough for anybody.',
  'Please insert disk 2.',
  'Yes, it plays that too.',
  "Your eyes can't smell past 160k Opus anyway.",
  'Maximum rotational velocidensity achieved.',
  'Do you believe in Santa, the Tooth Fairy, or FLAC?',
  'Stereo separation is a state of mind.',
  'Works offline. So did your Amiga.',
  'Does not support YouTube MP3 rips.',
  'Does not support Winamp plugins.',
  'Lossless gold-plated ears sold separately.',
  "It's pronounced eez-jee.",
  'This silence is lossless.',
  'Whips the llama respectfully.',
  'Pattern 00, Row 00, Order 00.',
  'What even is a PWA?',
  'Works on my machine.',
] as const;

export function pickIdlePlayerQuip(random = Math.random): string {
  const index = Math.floor(random() * IDLE_PLAYER_QUIPS.length);
  return IDLE_PLAYER_QUIPS[Math.min(Math.max(index, 0), IDLE_PLAYER_QUIPS.length - 1)];
}

export const sessionIdlePlayerQuip = pickIdlePlayerQuip();
