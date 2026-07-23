import { mount, unmount } from 'svelte';
import { writable, type Readable } from 'svelte/store';
import materialSymbolsFontUrl from '@material-symbols/font-400/material-symbols-outlined.woff2?url';
import MiniPlayer from '$lib/components/mini-player/MiniPlayer.svelte';
import type { PlaybackSnapshot, PlaylistItem } from '$lib/types';

interface MiniPlayerWindowOptions {
  width?: number;
  height?: number;
}

interface MiniPlayerWindowApi {
  requestWindow(options?: MiniPlayerWindowOptions): Promise<Window>;
}

interface WindowWithMiniPlayerApi extends Window {
  documentPictureInPicture?: MiniPlayerWindowApi;
}

interface MinimizeCapableWindow {
  minimize?: () => Promise<void>;
}

export interface MiniPlayerState {
  supported: boolean;
  active: boolean;
  opening: boolean;
}

interface CreateMiniPlayerControllerOptions {
  snapshot: Readable<PlaybackSnapshot>;
  track: Readable<PlaylistItem | null>;
  selectedTrack: Readable<PlaylistItem | null>;
  artworkUrl: Readable<string | null>;
  handlers: {
    togglePlayback: () => void;
    previousTrack: () => void;
    nextTrack: () => void;
    seek: (seconds: number) => void;
    setVolume: (volume: number) => void;
    toggleMute: () => void;
  };
}

const MINI_PLAYER_WIDTH = 350;
const MINI_PLAYER_HEIGHT = 100;

export function supportsMiniPlayer(
  windowLike: WindowWithMiniPlayerApi | undefined = typeof window === 'undefined'
    ? undefined
    : window as WindowWithMiniPlayerApi
): boolean {
  return typeof windowLike?.documentPictureInPicture?.requestWindow === 'function';
}

export async function minimizeMiniPlayerOpener(
  windowLike: MinimizeCapableWindow | undefined = typeof window === 'undefined'
    ? undefined
    : window as Window & MinimizeCapableWindow
): Promise<boolean> {
  if (typeof windowLike?.minimize !== 'function') {
    return false;
  }

  try {
    await windowLike.minimize();
    return true;
  } catch {
    // Additional Windowing Controls are limited to permitted installed-PWA windows.
    return false;
  }
}

function copyDocumentStyles(source: Document, target: Document): Promise<void> {
  const pendingStyles: Promise<void>[] = [];

  for (const styleSheet of Array.from(source.styleSheets)) {
    try {
      const style = target.createElement('style');
      style.textContent = Array.from(styleSheet.cssRules, (rule) => rule.cssText).join('\n');
      style.media = styleSheet.media.mediaText;
      target.head.append(style);
      continue;
    } catch {
      // Cross-origin stylesheets do not expose cssRules and must remain linked.
    }

    if (styleSheet.href) {
      const link = target.createElement('link');
      link.rel = 'stylesheet';
      link.href = styleSheet.href;
      link.media = styleSheet.media.mediaText;

      pendingStyles.push(new Promise((resolve) => {
        link.addEventListener('load', () => resolve(), { once: true });
        link.addEventListener('error', () => resolve(), { once: true });
      }));

      target.head.append(link);
    }
  }

  return Promise.all(pendingStyles).then(() => undefined);
}

export async function installMiniPlayerMaterialSymbols(target: Document): Promise<() => void> {
  try {
    const response = await fetch(materialSymbolsFontUrl);

    if (!response.ok) {
      return () => undefined;
    }

    const fontFace = new FontFace(
      'izci Mini Player Material Symbols',
      await response.arrayBuffer(),
      { style: 'normal', weight: '400', display: 'block' }
    );
    await fontFace.load();
    target.fonts.add(fontFace);

    const style = target.createElement('style');
    style.textContent = `
      .material-symbols-outlined {
        font-family: "izci Mini Player Material Symbols";
      }
    `;
    target.head.append(style);

    return () => {
      style.remove();
      target.fonts.delete(fontFace);
    };
  } catch {
    // Keep the copied @font-face as an online fallback if the cached font cannot be materialized.
    return () => undefined;
  }
}

function concealDocumentUntilReady(source: Document, target: Document): () => void {
  const bootstrapBackground = source.defaultView?.getComputedStyle(source.body).background;
  const bootstrapStyle = target.createElement('style');
  bootstrapStyle.dataset.miniPlayerBootstrap = '';
  bootstrapStyle.textContent = `
    html,
    body {
      width: 100%;
      height: 100%;
      margin: 0;
      background: var(--mini-player-bootstrap-background, #18191b);
      overflow: hidden;
    }

    body {
      visibility: hidden !important;
    }
  `;

  if (bootstrapBackground) {
    target.documentElement.style.setProperty('--mini-player-bootstrap-background', bootstrapBackground);
  }

  target.head.prepend(bootstrapStyle);

  return () => {
    bootstrapStyle.remove();
    target.documentElement.style.removeProperty('--mini-player-bootstrap-background');
  };
}

function syncDocumentRoot(source: Document, target: Document): void {
  target.documentElement.lang = source.documentElement.lang;
  target.documentElement.dir = source.documentElement.dir;
  target.documentElement.className = source.documentElement.className;
  target.documentElement.style.cssText = source.documentElement.style.cssText;

  for (const key of Object.keys(target.documentElement.dataset)) {
    delete target.documentElement.dataset[key];
  }

  for (const [key, value] of Object.entries(source.documentElement.dataset)) {
    if (value !== undefined) {
      target.documentElement.dataset[key] = value;
    }
  }
}

export function createMiniPlayerController({
  snapshot,
  track,
  selectedTrack,
  artworkUrl,
  handlers
}: CreateMiniPlayerControllerOptions) {
  const supported = supportsMiniPlayer();
  const store = writable<MiniPlayerState>({ supported, active: false, opening: false });
  let state: MiniPlayerState = { supported, active: false, opening: false };
  let miniPlayerWindow: Window | null = null;
  let mountedView: Record<string, unknown> | null = null;
  let rootObserver: MutationObserver | null = null;
  let releaseMaterialSymbols: (() => void) | null = null;
  let destroyed = false;

  const unsubscribeState = store.subscribe((value) => {
    state = value;
  });

  function setState(patch: Partial<MiniPlayerState>): void {
    store.set({ ...state, ...patch });
  }

  function releaseView(): void {
    const currentWindow = miniPlayerWindow;
    miniPlayerWindow = null;
    rootObserver?.disconnect();
    rootObserver = null;
    releaseMaterialSymbols?.();
    releaseMaterialSymbols = null;

    if (currentWindow) {
      currentWindow.removeEventListener('pagehide', releaseView);
    }

    if (mountedView) {
      void unmount(mountedView);
      mountedView = null;
    }

    setState({ active: false, opening: false });
  }

  async function open(): Promise<void> {
    if (!supported || destroyed || state.opening) {
      return;
    }

    if (miniPlayerWindow && !miniPlayerWindow.closed) {
      miniPlayerWindow.focus();
      return;
    }

    const api = (window as WindowWithMiniPlayerApi).documentPictureInPicture;

    if (!api) {
      return;
    }

    setState({ opening: true });

    try {
      const nextWindow = await api.requestWindow({
        width: MINI_PLAYER_WIDTH,
        height: MINI_PLAYER_HEIGHT
      });

      if (destroyed) {
        nextWindow.close();
        return;
      }

      miniPlayerWindow = nextWindow;
      nextWindow.document.title = 'izci';
      syncDocumentRoot(document, nextWindow.document);
      const revealDocument = concealDocumentUntilReady(document, nextWindow.document);
      nextWindow.addEventListener('pagehide', releaseView, { once: true });

      await copyDocumentStyles(document, nextWindow.document);

      const releaseNextMaterialSymbols = await installMiniPlayerMaterialSymbols(nextWindow.document);

      if (destroyed || miniPlayerWindow !== nextWindow || nextWindow.closed) {
        releaseNextMaterialSymbols();
        return;
      }

      releaseMaterialSymbols = releaseNextMaterialSymbols;

      const target = nextWindow.document.createElement('div');
      target.id = 'mini-player-root';
      nextWindow.document.body.replaceChildren(target);

      mountedView = mount(MiniPlayer, {
        target,
        props: {
          snapshotStore: snapshot,
          trackStore: track,
          selectedTrackStore: selectedTrack,
          artworkUrlStore: artworkUrl,
          onTogglePlayback: handlers.togglePlayback,
          onPreviousTrack: handlers.previousTrack,
          onNextTrack: handlers.nextTrack,
          onSeek: handlers.seek,
          onVolume: handlers.setVolume,
          onToggleMute: handlers.toggleMute
        }
      }) as Record<string, unknown>;

      await nextWindow.document.fonts.ready;

      if (destroyed || miniPlayerWindow !== nextWindow || nextWindow.closed) {
        return;
      }

      revealDocument();

      rootObserver = new MutationObserver(() => {
        if (miniPlayerWindow && !miniPlayerWindow.closed) {
          syncDocumentRoot(document, miniPlayerWindow.document);
        }
      });
      rootObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-theme', 'lang', 'dir']
      });

      setState({ active: true, opening: false });
      void minimizeMiniPlayerOpener();
    } catch (error) {
      const failedWindow = miniPlayerWindow;
      releaseView();
      failedWindow?.close();

      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        return;
      }

      console.warn('Could not open the mini player.', error);
    }
  }

  function close(): void {
    const currentWindow = miniPlayerWindow;
    releaseView();

    if (currentWindow && !currentWindow.closed) {
      currentWindow.close();
    }
  }

  function toggle(): void {
    if (state.active || miniPlayerWindow) {
      close();
      return;
    }

    void open();
  }

  function destroy(): void {
    destroyed = true;
    close();
    unsubscribeState();
  }

  return {
    subscribe: store.subscribe,
    getSnapshot: () => state,
    open,
    close,
    toggle,
    destroy
  };
}
