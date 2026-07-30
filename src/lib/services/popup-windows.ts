export interface PopupWindowDefinition {
  name: string;
  path: string;
  features: Record<string, boolean | number | string>;
}

export const popupWindows = {
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
  }
} satisfies Record<string, PopupWindowDefinition>;

export type PopupWindowId = keyof typeof popupWindows;
