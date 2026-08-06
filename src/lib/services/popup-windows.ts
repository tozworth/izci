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
  editor: {
    name: 'izci-editor',
    path: '/editor.html',
    features: {
      popup: true,
      width: 900,
      height: 350,
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
  },
  logs: {
    name: 'izci-logs',
    path: '/logs.html',
    features: {
      popup: true,
      width: 820,
      height: 560,
      resizable: true,
      scrollbars: false
    }
  }
} satisfies Record<string, PopupWindowDefinition>;

export type PopupWindowId = keyof typeof popupWindows;
