import { describe, expect, it } from 'vitest';
import {
  clampWaveformScrollStart,
  MAX_WAVEFORM_ZOOM,
  normalizeWaveformZoom,
  waveformViewportDuration,
  zoomWaveformViewport
} from './waveform-viewport';

describe('waveform viewport', () => {
  it('bounds zoom and derives the visible duration', () => {
    expect(normalizeWaveformZoom(0.5)).toBe(1);
    expect(normalizeWaveformZoom(128)).toBe(MAX_WAVEFORM_ZOOM);
    expect(waveformViewportDuration(120, 4)).toBe(30);
  });

  it('clamps scrolling to the visible time range', () => {
    expect(clampWaveformScrollStart(-4, 120, 4)).toBe(0);
    expect(clampWaveformScrollStart(100, 120, 4)).toBe(90);
    expect(clampWaveformScrollStart(20, 120, 1)).toBe(0);
  });

  it('keeps the selected anchor time stationary while zooming', () => {
    expect(zoomWaveformViewport(20, 120, 2, 4, 0.5)).toEqual({ zoom: 4, start: 35 });
    expect(zoomWaveformViewport(30, 120, 2, 4, 0)).toEqual({ zoom: 4, start: 30 });
  });

  it('clamps an anchored zoom at the clip edges', () => {
    expect(zoomWaveformViewport(0, 120, 1, 4, 0)).toEqual({ zoom: 4, start: 0 });
    expect(zoomWaveformViewport(0, 120, 1, 4, 1)).toEqual({ zoom: 4, start: 90 });
  });
});
