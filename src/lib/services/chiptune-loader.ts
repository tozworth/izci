import { ChiptuneJsPlayer, type Chiptune3Config } from 'chiptune3';

const PLAYER_INIT_TIMEOUT_MS = 10_000;
const PLAYER_CONFIG = {
  repeatCount: 0,
  stereoSeparation: 100,
  interpolationFilter: 0
} satisfies Chiptune3Config;

let playerPromise: Promise<ChiptuneJsPlayer> | null = null;

export async function ensureChiptunePlayer(): Promise<ChiptuneJsPlayer> {
  if (!playerPromise) {
    const player = new ChiptuneJsPlayer(PLAYER_CONFIG);

    playerPromise = new Promise<ChiptuneJsPlayer>((resolve, reject) => {
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        playerPromise = null;
        reject(new Error('Chiptune3 AudioWorklet did not initialize.'));
      }, PLAYER_INIT_TIMEOUT_MS);

      player.onInitialized(() => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        resolve(player);
      });

      player.onError((error) => {
        if (settled) {
          return;
        }

        settled = true;
        playerPromise = null;
        window.clearTimeout(timeoutId);
        reject(new Error(`Chiptune3 failed to initialize: ${error.type}`));
      });
    });
  }

  return playerPromise;
}
