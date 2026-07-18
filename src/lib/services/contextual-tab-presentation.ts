import type {
  ContextualTabAutomation,
  ModulePatternSnapshot,
  PlaybackState,
  PlaylistItem
} from '$lib/types';

export type ContextualTabAvailability = 'loading' | 'available' | 'unavailable';

export function resolvePatternTabAvailability(
  track: PlaylistItem | null,
  patternSnapshot: ModulePatternSnapshot,
  playbackState: PlaybackState
): ContextualTabAvailability {
  if (track?.kind !== 'module') {
    return 'unavailable';
  }

  if (patternSnapshot.trackId === track.id && patternSnapshot.song?.patterns.length) {
    return 'available';
  }

  return playbackState === 'loading' || playbackState === 'idle' ? 'loading' : 'unavailable';
}

interface ContextualTabPresentationSyncInput {
  key: string;
  availability: ContextualTabAvailability;
  automation: ContextualTabAutomation;
}

interface CreateContextualTabPresentationControllerOptions {
  isVisible: () => boolean;
  show: () => void;
  close: () => void;
}

export function createContextualTabPresentationController({
  isVisible,
  show,
  close
}: CreateContextualTabPresentationControllerOptions) {
  let automationSignature = '';

  function sync(input: ContextualTabPresentationSyncInput): void {
    if (input.availability === 'loading') {
      return;
    }

    const signature = `${input.key}:${input.availability}:${input.automation}`;

    if (signature === automationSignature) {
      return;
    }

    automationSignature = signature;

    if (input.availability === 'available' && input.automation !== 'manual') {
      show();
    } else if (
      input.availability === 'unavailable' &&
      input.automation === 'open-close' &&
      isVisible()
    ) {
      close();
    }
  }

  return { sync };
}
