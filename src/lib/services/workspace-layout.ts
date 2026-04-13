import type {
  WorkspacePanelId,
  WorkspacePanelLayoutSettings,
  WorkspaceResizeHandle
} from '$lib/types';

const HORIZONTAL_PADDING = 24;

export const WORKSPACE_RESIZER_WIDTH = 14;
export const WIDE_PANEL_MIN_WIDTHS: Record<WorkspacePanelId, number> = {
  playlist: 250,
  library: 320,
  details: 240
};

interface WideWorkspaceLayoutOptions {
  detailsVisible?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toPanelLayoutSettings(
  widths: Record<WorkspacePanelId, number>
): WorkspacePanelLayoutSettings {
  const total = widths.playlist + widths.library + widths.details;

  if (total <= 0) {
    return {
      playlistFraction: 0,
      libraryFraction: 0,
      detailsFraction: 0
    };
  }

  return {
    playlistFraction: widths.playlist / total,
    libraryFraction: widths.library / total,
    detailsFraction: widths.details / total
  };
}

export function getWideContentWidth(
  viewportWidth: number,
  options: WideWorkspaceLayoutOptions = {}
): number {
  const resizerCount = options.detailsVisible === false ? 1 : 2;
  return Math.max(viewportWidth - HORIZONTAL_PADDING - WORKSPACE_RESIZER_WIDTH * resizerCount, 0);
}

export function resolveWidePanelWidths(
  layout: WorkspacePanelLayoutSettings,
  contentWidth: number,
  options: WideWorkspaceLayoutOptions = {}
): Record<WorkspacePanelId, number> {
  const playlistMin = WIDE_PANEL_MIN_WIDTHS.playlist;
  const libraryMin = WIDE_PANEL_MIN_WIDTHS.library;
  const detailsMin = WIDE_PANEL_MIN_WIDTHS.details;
  const detailsVisible = options.detailsVisible !== false;

  if (!detailsVisible) {
    if (contentWidth <= 0) {
      return {
        playlist: playlistMin,
        library: libraryMin,
        details: 0
      };
    }

    if (contentWidth <= playlistMin + libraryMin) {
      const scale = contentWidth / (playlistMin + libraryMin);
      return {
        playlist: playlistMin * scale,
        library: libraryMin * scale,
        details: 0
      };
    }

    const visibleFractionTotal = layout.playlistFraction + layout.libraryFraction;
    const playlistFraction =
      visibleFractionTotal > 0 ? layout.playlistFraction / visibleFractionTotal : 0.5;
    const libraryFraction = 1 - playlistFraction;
    let playlist = playlistFraction * contentWidth;
    let library = libraryFraction * contentWidth;

    if (playlist < playlistMin) {
      playlist = playlistMin;
      library = contentWidth - playlist;
    }

    if (library < libraryMin) {
      library = libraryMin;
      playlist = contentWidth - library;
    }

    return { playlist, library, details: 0 };
  }

  if (contentWidth <= 0) {
    return {
      playlist: playlistMin,
      library: libraryMin,
      details: detailsMin
    };
  }

  if (contentWidth <= playlistMin + libraryMin + detailsMin) {
    const scale = contentWidth / (playlistMin + libraryMin + detailsMin);
    return {
      playlist: playlistMin * scale,
      library: libraryMin * scale,
      details: detailsMin * scale
    };
  }

  let playlist = layout.playlistFraction * contentWidth;
  let library = layout.libraryFraction * contentWidth;
  let details = layout.detailsFraction * contentWidth;

  if (playlist < playlistMin) {
    const delta = playlistMin - playlist;
    playlist = playlistMin;
    const availableReduction = Math.max(library - libraryMin, 0) + Math.max(details - detailsMin, 0);

    if (availableReduction > 0) {
      const libraryShare = Math.max(library - libraryMin, 0) / availableReduction;
      library -= delta * libraryShare;
      details -= delta * (1 - libraryShare);
    }
  }

  if (library < libraryMin) {
    const delta = libraryMin - library;
    library = libraryMin;
    const availableReduction = Math.max(playlist - playlistMin, 0) + Math.max(details - detailsMin, 0);

    if (availableReduction > 0) {
      const playlistShare = Math.max(playlist - playlistMin, 0) / availableReduction;
      playlist -= delta * playlistShare;
      details -= delta * (1 - playlistShare);
    }
  }

  if (details < detailsMin) {
    const delta = detailsMin - details;
    details = detailsMin;
    const availableReduction = Math.max(playlist - playlistMin, 0) + Math.max(library - libraryMin, 0);

    if (availableReduction > 0) {
      const playlistShare = Math.max(playlist - playlistMin, 0) / availableReduction;
      playlist -= delta * playlistShare;
      library -= delta * (1 - playlistShare);
    }
  }

  const total = playlist + library + details;
  const correction = contentWidth - total;
  library += correction;

  return { playlist, library, details };
}

export function resolveResizedPanelLayout(options: {
  handle: WorkspaceResizeHandle;
  startLayout: WorkspacePanelLayoutSettings;
  delta: number;
  contentWidth: number;
  detailsVisible?: boolean;
}): WorkspacePanelLayoutSettings {
  const startWidths = resolveWidePanelWidths(options.startLayout, options.contentWidth, {
    detailsVisible: options.detailsVisible
  });

  if (options.handle === 'playlist-library') {
    const nextPlaylist = clamp(
      startWidths.playlist + options.delta,
      WIDE_PANEL_MIN_WIDTHS.playlist,
      startWidths.playlist + startWidths.library - WIDE_PANEL_MIN_WIDTHS.library
    );

    return toPanelLayoutSettings({
      ...startWidths,
      playlist: nextPlaylist,
      library: startWidths.playlist + startWidths.library - nextPlaylist
    });
  }

  const nextLibrary = clamp(
    startWidths.library + options.delta,
    WIDE_PANEL_MIN_WIDTHS.library,
    startWidths.library + startWidths.details - WIDE_PANEL_MIN_WIDTHS.details
  );

  return toPanelLayoutSettings({
    ...startWidths,
    library: nextLibrary,
    details: startWidths.library + startWidths.details - nextLibrary
  });
}
