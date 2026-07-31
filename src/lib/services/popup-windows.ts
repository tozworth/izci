export interface PopupWindowDefinition {
  name: string;
  path: string;
  features: Record<string, boolean | number | string>;
}

export const popupWindows = {
  audioCompare: {
    name: 'izci-audio-compare',
    path: '/audio-compare.html',
    features: {
      popup: true,
      width: 1120,
      height: 720,
      resizable: true,
      scrollbars: false
    }
  },
  options: {
    name: 'izci-options',
    path: '/options.html',
    features: {
      popup: true,
      width: 680,
      height: 460,
      resizable: true,
      scrollbars: true
    }
  },
  clipTag: {
    name: 'izci-clip-and-tag',
    path: '/clip-tag.html',
    features: {
      popup: true,
      width: 980,
      height: 680,
      resizable: true,
      scrollbars: false
    }
  },
  converter: {
    name: 'izci-converter',
    path: '/converter.html',
    features: {
      popup: true,
      width: 1120,
      height: 720,
      resizable: true,
      scrollbars: false
    }
  },
  spectrogram: {
    name: 'izci-spectrogram',
    path: '/spectrogram.html',
    features: {
      popup: true,
      width: 1020,
      height: 680,
      resizable: true,
      scrollbars: false
    }
  },
  troubadour: {
    name: 'izci-troubadour',
    path: '/troubadour.html',
    features: {
      popup: true,
      width: 1280,
      height: 820,
      resizable: true,
      scrollbars: false
    }
  },
  troubadourOptions: {
    name: 'izci-troubadour-options',
    path: '/troubadour-options.html',
    features: {
      popup: true,
      width: 760,
      height: 560,
      resizable: true,
      scrollbars: true
    }
  }
} satisfies Record<string, PopupWindowDefinition>;

export type PopupWindowId = keyof typeof popupWindows;
