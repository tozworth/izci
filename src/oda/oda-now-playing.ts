/**
 * Oda Now Playing focus IDs.
 *
 * The transport strip and queue rail are two navigation regions linked by the
 * now-playing focus model, so both OdaShell and the view need the same IDs.
 */

export const ODA_NP_PLAY_PAUSE = 'np:play-pause';
export const ODA_NP_PREVIOUS = 'np:previous';
export const ODA_NP_NEXT = 'np:next';
export const ODA_NP_SHUFFLE = 'np:shuffle';
export const ODA_NP_REPEAT = 'np:repeat';
export const ODA_NP_SEEK_BACK = 'np:seek-back';
export const ODA_NP_SEEK_FORWARD = 'np:seek-forward';
export const ODA_NP_SEEK_STEP_SECONDS = 10;

export function resolveOdaNowPlayingTransportIds(): string[] {
  return [
    ODA_NP_PREVIOUS,
    ODA_NP_PLAY_PAUSE,
    ODA_NP_NEXT,
    ODA_NP_SEEK_BACK,
    ODA_NP_SEEK_FORWARD,
    ODA_NP_SHUFFLE,
    ODA_NP_REPEAT
  ];
}
