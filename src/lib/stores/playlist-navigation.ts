import type { PlaylistItem, PlaylistRepeatMode } from '$lib/types';

interface ShuffleSessionState {
  history: string[];
  cursor: number;
  upcoming: string[];
}

export function createPlaylistNavigation(getItems: () => PlaylistItem[]) {
  let shuffleSession: ShuffleSessionState = {
    history: [],
    cursor: -1,
    upcoming: []
  };

  function reset(): void {
    shuffleSession = {
      history: [],
      cursor: -1,
      upcoming: []
    };
  }

  function shuffleIds(ids: string[]): string[] {
    const shuffled = [...ids];

    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }

    return shuffled;
  }

  function getTrackById(id: string | null): PlaylistItem | null {
    if (!id) {
      return null;
    }

    return getItems().find((item) => item.id === id) ?? null;
  }

  function resolveExhaustedStepTrack(baseId: string | null): PlaylistItem | null {
    const currentTrack = getTrackById(baseId);

    if (!currentTrack) {
      return null;
    }

    const hasAlternativeTrack = getItems().some((item) => item.id !== currentTrack.id);
    return hasAlternativeTrack ? null : currentTrack;
  }

  function buildShuffleCycle(currentId: string | null): string[] {
    const itemList = getItems();

    if (itemList.length === 0) {
      return [];
    }

    if (itemList.length === 1) {
      return currentId ? [currentId] : [itemList[0].id];
    }

    return shuffleIds(itemList.map((item) => item.id).filter((id) => id !== currentId));
  }

  function initializeShuffleSession(currentId: string | null): void {
    const itemList = getItems();
    const initialTrack = getTrackById(currentId) ?? itemList[0] ?? null;

    if (!initialTrack) {
      reset();
      return;
    }

    shuffleSession = {
      history: [initialTrack.id],
      cursor: 0,
      upcoming: shuffleIds(itemList.map((item) => item.id).filter((id) => id !== initialTrack.id))
    };
  }

  function syncShuffleSession(currentId: string | null): void {
    const itemList = getItems();

    if (itemList.length === 0) {
      reset();
      return;
    }

    if (!currentId || !getTrackById(currentId)) {
      if (shuffleSession.cursor === -1 || !getTrackById(shuffleSession.history[shuffleSession.cursor] ?? null)) {
        initializeShuffleSession(itemList[0]?.id ?? null);
      }

      return;
    }

    if (shuffleSession.history[shuffleSession.cursor] === currentId) {
      return;
    }

    const existingIndex = shuffleSession.history.lastIndexOf(currentId);

    if (existingIndex !== -1) {
      shuffleSession.cursor = existingIndex;
      return;
    }

    initializeShuffleSession(currentId);
  }

  function resolveLinearTrack(baseId: string | null, direction: -1 | 1, wrap: boolean): PlaylistItem | null {
    const itemList = getItems();

    if (itemList.length === 0) {
      return null;
    }

    const currentIndex = baseId ? itemList.findIndex((item) => item.id === baseId) : -1;

    if (currentIndex === -1) {
      return direction > 0 ? itemList[0] : itemList[itemList.length - 1];
    }

    const nextIndex = currentIndex + direction;

    if (nextIndex >= 0 && nextIndex < itemList.length) {
      return itemList[nextIndex];
    }

    if (!wrap) {
      return resolveExhaustedStepTrack(baseId);
    }

    return direction > 0 ? itemList[0] : itemList[itemList.length - 1];
  }

  function resolveShuffledTrack(baseId: string | null, direction: -1 | 1, wrap: boolean): PlaylistItem | null {
    if (getItems().length === 0) {
      return null;
    }

    syncShuffleSession(baseId);

    if (shuffleSession.cursor === -1) {
      return null;
    }

    if (direction < 0) {
      if (shuffleSession.cursor > 0) {
        return getTrackById(shuffleSession.history[shuffleSession.cursor - 1] ?? null);
      }

      if (!wrap) {
        return resolveExhaustedStepTrack(baseId);
      }

      const previousCycle = buildShuffleCycle(baseId);

      if (previousCycle.length === 0) {
        return getTrackById(baseId);
      }

      shuffleSession = {
        history: [...previousCycle, ...shuffleSession.history],
        cursor: previousCycle.length,
        upcoming: shuffleSession.upcoming
      };

      return getTrackById(shuffleSession.history[shuffleSession.cursor - 1] ?? null);
    }

    if (shuffleSession.cursor < shuffleSession.history.length - 1) {
      return getTrackById(shuffleSession.history[shuffleSession.cursor + 1] ?? null);
    }

    if (shuffleSession.upcoming.length > 0) {
      const [nextId, ...remaining] = shuffleSession.upcoming;

      shuffleSession = {
        history: [...shuffleSession.history, nextId],
        cursor: shuffleSession.history.length,
        upcoming: remaining
      };

      return getTrackById(nextId);
    }

    if (!wrap) {
      return resolveExhaustedStepTrack(baseId);
    }

    const nextCycle = buildShuffleCycle(baseId);

    if (nextCycle.length === 0) {
      return getTrackById(baseId);
    }

    const [nextId, ...remaining] = nextCycle;

    shuffleSession = {
      history: [...shuffleSession.history, nextId],
      cursor: shuffleSession.history.length,
      upcoming: remaining
    };

    return getTrackById(nextId);
  }

  return {
    reset,
    resolveStartTrack(options: {
      selectedId?: string | null;
      shuffle?: boolean;
    } = {}): PlaylistItem | null {
      const { selectedId = null, shuffle = false } = options;

      if (!shuffle) {
        return getTrackById(selectedId);
      }

      const shuffledIds = shuffleIds(getItems().map((item) => item.id));
      const initialTrack = getTrackById(shuffledIds[0] ?? null);

      if (!initialTrack) {
        reset();
        return null;
      }

      shuffleSession = {
        history: [initialTrack.id],
        cursor: 0,
        upcoming: shuffledIds.slice(1)
      };

      return initialTrack;
    },
    resolveStepTrack(options: {
      currentId?: string | null;
      selectedId?: string | null;
      direction: -1 | 1;
      shuffle?: boolean;
      wrap?: boolean;
    }): PlaylistItem | null {
      const { currentId = null, selectedId = null, direction, shuffle = false, wrap = false } = options;
      const baseId = currentId ?? selectedId;

      if (shuffle) {
        if (!baseId) {
          const itemList = getItems();
          const initialTrack = direction > 0 ? itemList[0] ?? null : itemList[itemList.length - 1] ?? null;

          if (!initialTrack) {
            return null;
          }

          initializeShuffleSession(initialTrack.id);
          return initialTrack;
        }

        return resolveShuffledTrack(baseId, direction, wrap);
      }

      return resolveLinearTrack(baseId, direction, wrap);
    },
    resolveTrackEnd(options: {
      currentId?: string | null;
      shuffle?: boolean;
      repeatMode?: PlaylistRepeatMode;
    }): PlaylistItem | null {
      const { currentId = null, shuffle = false, repeatMode = 'off' } = options;

      if (!currentId) {
        return null;
      }

      if (repeatMode === 'one') {
        return getItems().find((item) => item.id === currentId) ?? null;
      }

      if (shuffle) {
        return resolveShuffledTrack(currentId, 1, repeatMode === 'all');
      }

      return resolveLinearTrack(currentId, 1, repeatMode === 'all');
    }
  };
}
