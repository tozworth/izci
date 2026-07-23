import { mount, unmount } from 'svelte';
import { writable, type Readable } from 'svelte/store';
import DocumentPipPlayer from '$lib/components/document-pip/DocumentPipPlayer.svelte';
import type { PlaybackSnapshot, PlaylistItem } from '$lib/types';

interface DocumentPictureInPictureOptions {
  width?: number;
  height?: number;
}

interface DocumentPictureInPictureApi {
  requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>;
}

interface WindowWithDocumentPictureInPicture extends Window {
  documentPictureInPicture?: DocumentPictureInPictureApi;
}

export interface DocumentPipState {
  supported: boolean;
  active: boolean;
  opening: boolean;
}

interface CreateDocumentPipControllerOptions {
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

const DOCUMENT_PIP_WIDTH = 440;
const DOCUMENT_PIP_HEIGHT = 138;

export function supportsDocumentPictureInPicture(
  windowLike: WindowWithDocumentPictureInPicture | undefined = typeof window === 'undefined'
    ? undefined
    : window as WindowWithDocumentPictureInPicture
): boolean {
  return typeof windowLike?.documentPictureInPicture?.requestWindow === 'function';
}

function copyDocumentStyles(source: Document, target: Document): void {
  for (const styleSheet of Array.from(source.styleSheets)) {
    if (styleSheet.href) {
      const link = target.createElement('link');
      link.rel = 'stylesheet';
      link.href = styleSheet.href;
      target.head.append(link);
      continue;
    }

    try {
      const style = target.createElement('style');
      style.textContent = Array.from(styleSheet.cssRules, (rule) => rule.cssText).join('\n');
      target.head.append(style);
    } catch {
      // Cross-origin stylesheets cannot expose cssRules. Linked sheets are handled above.
    }
  }
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

export function createDocumentPipController({
  snapshot,
  track,
  selectedTrack,
  artworkUrl,
  handlers
}: CreateDocumentPipControllerOptions) {
  const supported = supportsDocumentPictureInPicture();
  const store = writable<DocumentPipState>({ supported, active: false, opening: false });
  let state: DocumentPipState = { supported, active: false, opening: false };
  let pipWindow: Window | null = null;
  let mountedView: Record<string, unknown> | null = null;
  let rootObserver: MutationObserver | null = null;
  let destroyed = false;

  const unsubscribeState = store.subscribe((value) => {
    state = value;
  });

  function setState(patch: Partial<DocumentPipState>): void {
    store.set({ ...state, ...patch });
  }

  function releaseView(): void {
    const currentWindow = pipWindow;
    pipWindow = null;
    rootObserver?.disconnect();
    rootObserver = null;

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

    if (pipWindow && !pipWindow.closed) {
      pipWindow.focus();
      return;
    }

    const api = (window as WindowWithDocumentPictureInPicture).documentPictureInPicture;

    if (!api) {
      return;
    }

    setState({ opening: true });

    try {
      const nextWindow = await api.requestWindow({
        width: DOCUMENT_PIP_WIDTH,
        height: DOCUMENT_PIP_HEIGHT
      });

      if (destroyed) {
        nextWindow.close();
        return;
      }

      pipWindow = nextWindow;
      nextWindow.document.title = 'izci';
      copyDocumentStyles(document, nextWindow.document);
      syncDocumentRoot(document, nextWindow.document);

      const target = nextWindow.document.createElement('div');
      target.id = 'document-pip-root';
      nextWindow.document.body.replaceChildren(target);

      mountedView = mount(DocumentPipPlayer, {
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

      rootObserver = new MutationObserver(() => {
        if (pipWindow && !pipWindow.closed) {
          syncDocumentRoot(document, pipWindow.document);
        }
      });
      rootObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-theme', 'lang', 'dir']
      });

      nextWindow.addEventListener('pagehide', releaseView, { once: true });
      setState({ active: true, opening: false });
    } catch (error) {
      const failedWindow = pipWindow;
      releaseView();
      failedWindow?.close();

      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        return;
      }

      console.warn('Could not open the picture-in-picture player.', error);
    }
  }

  function close(): void {
    const currentWindow = pipWindow;
    releaseView();

    if (currentWindow && !currentWindow.closed) {
      currentWindow.close();
    }
  }

  function toggle(): void {
    if (state.active || pipWindow) {
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
