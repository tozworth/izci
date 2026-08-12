import type { WorkspacePanelId, WorkspacePanelLayoutSettings, WorkspaceResizeHandle } from '$lib/contracts/workspace';
import { WORKSPACE_PANEL_IDS } from '$lib/contracts/workspace';

const HORIZONTAL_PADDING = 0;

export const WORKSPACE_RESIZER_WIDTH = 1;
export const WIDE_PANEL_MIN_WIDTHS: Record<WorkspacePanelId, number> = {
  left: 210,
  center: 320,
  right: 200
};

export interface ResponsiveWorkspacePanels {
  visiblePanels: WorkspacePanelId[];
  collapsedPanels: WorkspacePanelId[];
}

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
    case 'left':
      return layout.leftFraction;
    case 'center':
      return layout.centerFraction;
    case 'right':
      return layout.rightFraction;
  }
}

function setLayoutFraction(
  layout: WorkspacePanelLayoutSettings,
  panelId: WorkspacePanelId,
  value: number
): void {
  switch (panelId) {
    case 'left':
      layout.leftFraction = value;
      break;
    case 'center':
      layout.centerFraction = value;
      break;
    case 'right':
      layout.rightFraction = value;
      break;
  }
}

function resolveVisiblePanels(options: WideWorkspaceLayoutOptions = {}): WorkspacePanelId[] {
  if (options.visiblePanels) {
    const visibleSet = new Set(options.visiblePanels);
    return WORKSPACE_PANEL_IDS.filter((panelId) => visibleSet.has(panelId));
  }

  return options.detailsVisible === false
    ? ['left', 'center']
    : [...WORKSPACE_PANEL_IDS];
}

function getRequiredPanelWidth(panelIds: WorkspacePanelId[]): number {
  const resizerCount = Math.max(panelIds.length - 1, 0);

  return panelIds.reduce(
    (total, panelId) => total + WIDE_PANEL_MIN_WIDTHS[panelId],
    WORKSPACE_RESIZER_WIDTH * resizerCount
  );
}

export function resolveResponsiveWorkspacePanels(
  viewportWidth: number,
  logicalPanels: WorkspacePanelId[]
): ResponsiveWorkspacePanels {
  const logicalPanelSet = new Set(logicalPanels);
  let visiblePanels = WORKSPACE_PANEL_IDS.filter((panelId) => logicalPanelSet.has(panelId));
  const collapsedPanels: WorkspacePanelId[] = [];

  while (visiblePanels.length > 0 && viewportWidth < getRequiredPanelWidth(visiblePanels)) {
    const panelToCollapse = visiblePanels.includes('right')
      ? 'right'
      : visiblePanels.includes('left')
        ? 'left'
        : null;

    if (!panelToCollapse) {
      break;
    }

    collapsedPanels.push(panelToCollapse);
    visiblePanels = visiblePanels.filter((panelId) => panelId !== panelToCollapse);

    if (!visiblePanels.includes('center')) {
      visiblePanels.push('center');
      visiblePanels = WORKSPACE_PANEL_IDS.filter((panelId) => visiblePanels.includes(panelId));
    }
  }

  return {
    visiblePanels,
    collapsedPanels: WORKSPACE_PANEL_IDS.filter((panelId) => collapsedPanels.includes(panelId))
  };
}

function getPanelWidthTotal(
  widths: Record<WorkspacePanelId, number>,
  panelIds: WorkspacePanelId[]
): number {
  return panelIds.reduce((total, panelId) => total + widths[panelId], 0);
}

function normalizeLayout(layout: WorkspacePanelLayoutSettings): WorkspacePanelLayoutSettings {
  const leftFraction = Math.max(layout.leftFraction, 0);
  const centerFraction = Math.max(layout.centerFraction, 0);
  const rightFraction = Math.max(layout.rightFraction, 0);
  const total = leftFraction + centerFraction + rightFraction;

  if (total <= 0) {
    return {
      leftFraction: 1 / 3,
      centerFraction: 1 / 3,
      rightFraction: 1 / 3
    };
  }

  return {
    leftFraction: leftFraction / total,
    centerFraction: centerFraction / total,
    rightFraction: rightFraction / total
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
    leftFraction: normalizedStartLayout.leftFraction,
    centerFraction: normalizedStartLayout.centerFraction,
    rightFraction: normalizedStartLayout.rightFraction
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
    nextLayout.leftFraction + nextLayout.centerFraction + nextLayout.rightFraction;
  const correction = 1 - total;
  const correctionPanel = visiblePanels[visiblePanels.length - 1] ?? 'center';
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
    left: 0,
    center: 0,
    right: 0
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
