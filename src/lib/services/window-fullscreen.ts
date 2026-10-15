let controllerFullscreenActive = false;

function hasFullscreenDocument(): boolean {
  return typeof document !== 'undefined' && Boolean(document.fullscreenElement);
}

if (typeof document !== 'undefined') {
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      controllerFullscreenActive = false;
    }
  });
}

export const windowFullscreen = {
  isFullscreen: hasFullscreenDocument,
  isControllerFullscreenActive(): boolean {
    return controllerFullscreenActive && hasFullscreenDocument();
  },
  async enter(): Promise<boolean> {
    if (typeof document === 'undefined') {
      return false;
    }

    if (document.fullscreenElement) {
      return false;
    }

    try {
      await document.documentElement.requestFullscreen();
      controllerFullscreenActive = true;
      return true;
    } catch {
      controllerFullscreenActive = false;
      return false;
    }
  },
  async exit(): Promise<boolean> {
    if (typeof document === 'undefined' || !document.fullscreenElement) {
      controllerFullscreenActive = false;
      return false;
    }

    try {
      await document.exitFullscreen();
      controllerFullscreenActive = false;
      return true;
    } catch {
      return false;
    }
  }
};
