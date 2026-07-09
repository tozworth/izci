import type {
  WorkspacePanelId,
  WorkspacePanelLayoutSettings,
  WorkspaceResizeHandle
} from '$lib/types';
import { WORKSPACE_PANEL_IDS } from '$lib/types';

const HORIZONTAL_PADDING = 0;

export const WORKSPACE_RESIZER_WIDTH = 1;
export const WIDE_PANEL_MIN_WIDTHS: Record<WorkspacePanelId, number> = {
  playlist: 250,
  library: 320,
  details: 240
};

interface WideWorkspaceLayoutOptions {
  visiblePanels?: WorkspacePanelId[];
  detailsVisible?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getLayoutFraction(
  layout: WorkspacePanelLayoutSettings,
  panelId: WorkspacePanelId
): number {
  switch (panelId) {
    case 'playlist':
      return layout.playlistFraction;
    case 'library':
      return layout.libraryFraction;
    case 'details':
      return layout.detailsFraction;
  }
}

function setLayoutFraction(
  layout: WorkspacePanelLayoutSettings,
  panelId: WorkspacePanelId,
  value: number
): void {
  switch (panelId) {
    case 'playlist':
      layout.playlistFraction = value;
      break;
    case 'library':
      layout.libraryFraction = value;
      break;
    case 'details':
      layout.detailsFraction = value;
      break;
  }
}

function resolveVisiblePanels(options: WideWorkspaceLayoutOptions = {}): WorkspacePanelId[] {
  if (options.visiblePanels) {
    const visibleSet = new Set(options.visiblePanels);
    return WORKSPACE_PANEL_IDS.filter((panelId) => visibleSet.has(panelId));
  }

  return options.detailsVisible === false
    ? ['playlist', 'library']
    : [...WORKSPACE_PANEL_IDS];
}

function getPanelWidthTotal(
  widths: Record<WorkspacePanelId, number>,
  panelIds: WorkspacePanelId[]
): number {
  return panelIds.reduce((total, panelId) => total + widths[panelId], 0);
}

function normalizeLayout(layout: WorkspacePanelLayoutSettings): WorkspacePanelLayoutSettings {
  const playlistFraction = Math.max(layout.playlistFraction, 0);
  const libraryFraction = Math.max(layout.libraryFraction, 0);
  const detailsFraction = Math.max(layout.detailsFraction, 0);
  const total = playlistFraction + libraryFraction + detailsFraction;

  if (total <= 0) {
    return {
      playlistFraction: 1 / 3,
      libraryFraction: 1 / 3,
      detailsFraction: 1 / 3
    };
  }

  return {
    playlistFraction: playlistFraction / total,
    libraryFraction: libraryFraction / total,
    detailsFraction: detailsFraction / total
  };
}

function toPanelLayoutSettings(
  widths: Record<WorkspacePanelId, number>,
  startLayout: WorkspacePanelLayoutSettings,
  visiblePanels: WorkspacePanelId[]
): WorkspacePanelLayoutSettings {
  const normalizedStartLayout = normalizeLayout(startLayout);
  const visibleSet = new Set(visiblePanels);
  const hiddenPanels = WORKSPACE_PANEL_IDS.filter((panelId) => !visibleSet.has(panelId));
  const hiddenFractionTotal = hiddenPanels.reduce(
    (total, panelId) => total + getLayoutFraction(normalizedStartLayout, panelId),
    0
  );
  const visibleFractionTotal = Math.max(1 - hiddenFractionTotal, 0);
  const visibleWidthTotal = getPanelWidthTotal(widths, visiblePanels);
  const nextLayout: WorkspacePanelLayoutSettings = {
    playlistFraction: normalizedStartLayout.playlistFraction,
    libraryFraction: normalizedStartLayout.libraryFraction,
    detailsFraction: normalizedStartLayout.detailsFraction
  };

  if (visiblePanels.length === 0 || visibleWidthTotal <= 0 || visibleFractionTotal <= 0) {
    return nextLayout;
  }

  for (const panelId of visiblePanels) {
    setLayoutFraction(
      nextLayout,
      panelId,
      (widths[panelId] / visibleWidthTotal) * visibleFractionTotal
    );
  }

  const total =
    nextLayout.playlistFraction + nextLayout.libraryFraction + nextLayout.detailsFraction;
  const correction = 1 - total;
  const correctionPanel = visiblePanels[visiblePanels.length - 1] ?? 'library';
  setLayoutFraction(
    nextLayout,
    correctionPanel,
    Math.max(getLayoutFraction(nextLayout, correctionPanel) + correction, 0)
  );

  return nextLayout;
}

export function getWideContentWidth(
  viewportWidth: number,
  options: WideWorkspaceLayoutOptions = {}
): number {
  const visiblePanelCount = resolveVisiblePanels(options).length;
  const resizerCount = Math.max(visiblePanelCount - 1, 0);
  return Math.max(viewportWidth - HORIZONTAL_PADDING - WORKSPACE_RESIZER_WIDTH * resizerCount, 0);
}

export function resolveWidePanelWidths(
  layout: WorkspacePanelLayoutSettings,
  contentWidth: number,
  options: WideWorkspaceLayoutOptions = {}
): Record<WorkspacePanelId, number> {
  const visiblePanels = resolveVisiblePanels(options);
  const visibleSet = new Set(visiblePanels);
  const widths: Record<WorkspacePanelId, number> = {
    playlist: 0,
    library: 0,
    details: 0
  };

  if (visiblePanels.length === 0) {
    return widths;
  }

  const minWidthTotal = visiblePanels.reduce(
    (total, panelId) => total + WIDE_PANEL_MIN_WIDTHS[panelId],
    0
  );

  if (contentWidth <= 0) {
    for (const panelId of visiblePanels) {
      widths[panelId] = WIDE_PANEL_MIN_WIDTHS[panelId];
    }

    return widths;
  }

  if (contentWidth <= minWidthTotal) {
    const scale = contentWidth / minWidthTotal;

    for (const panelId of visiblePanels) {
      widths[panelId] = WIDE_PANEL_MIN_WIDTHS[panelId] * scale;
    }

    return widths;
  }

  const normalizedLayout = normalizeLayout(layout);
  let remainingPanels = visiblePanels;
  let remainingWidth = contentWidth;
  let remainingFraction = remainingPanels.reduce(
    (total, panelId) => total + getLayoutFraction(normalizedLayout, panelId),
    0
  );

  while (remainingPanels.length > 0) {
    const constrainedPanels = remainingPanels.filter((panelId) => {
      const fraction = getLayoutFraction(normalizedLayout, panelId);
      const width =
        remainingFraction > 0
          ? (fraction / remainingFraction) * remainingWidth
          : remainingWidth / remainingPanels.length;

      return width < WIDE_PANEL_MIN_WIDTHS[panelId];
    });

    if (constrainedPanels.length === 0) {
      break;
    }

    for (const panelId of constrainedPanels) {
      widths[panelId] = WIDE_PANEL_MIN_WIDTHS[panelId];
      remainingWidth -= widths[panelId];
      remainingFraction -= getLayoutFraction(normalizedLayout, panelId);
    }

    remainingPanels = remainingPanels.filter((panelId) => !constrainedPanels.includes(panelId));
  }

  for (const panelId of remainingPanels) {
    const fraction = getLayoutFraction(normalizedLayout, panelId);
    widths[panelId] =
      remainingFraction > 0
        ? (fraction / remainingFraction) * remainingWidth
        : remainingWidth / remainingPanels.length;
  }

  for (const panelId of WORKSPACE_PANEL_IDS) {
    if (!visibleSet.has(panelId)) {
      widths[panelId] = 0;
    }
  }

  const total = getPanelWidthTotal(widths, visiblePanels);
  const correction = contentWidth - total;
  const correctionPanel = visiblePanels.find((panelId) => widths[panelId] > 0);

  if (correctionPanel) {
    widths[correctionPanel] += correction;
  }

  return widths;
}

export function resolveResizedPanelLayout(options: {
  handle: WorkspaceResizeHandle;
  startLayout: WorkspacePanelLayoutSettings;
  delta: number;
  contentWidth: number;
  visiblePanels?: WorkspacePanelId[];
  detailsVisible?: boolean;
}): WorkspacePanelLayoutSettings {
  const visiblePanels = resolveVisiblePanels(options);

  if (
    !visiblePanels.includes(options.handle.before) ||
    !visiblePanels.includes(options.handle.after)
  ) {
    return options.startLayout;
  }

  const startWidths = resolveWidePanelWidths(options.startLayout, options.contentWidth, {
    visiblePanels
  });
  const beforeWidth = startWidths[options.handle.before];
  const afterWidth = startWidths[options.handle.after];
  const combinedWidth = beforeWidth + afterWidth;
  const beforeMinWidth = WIDE_PANEL_MIN_WIDTHS[options.handle.before];
  const afterMinWidth = WIDE_PANEL_MIN_WIDTHS[options.handle.after];

  if (combinedWidth <= beforeMinWidth + afterMinWidth) {
    return options.startLayout;
  }

  const nextBeforeWidth = clamp(
    beforeWidth + options.delta,
    beforeMinWidth,
    combinedWidth - afterMinWidth
  );
  const nextWidths = {
    ...startWidths,
    [options.handle.before]: nextBeforeWidth,
    [options.handle.after]: combinedWidth - nextBeforeWidth
  };

  return toPanelLayoutSettings(nextWidths, options.startLayout, visiblePanels);
}
