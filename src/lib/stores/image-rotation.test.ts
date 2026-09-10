import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
  imageRotation,
  isSidewaysRotation,
  normalizeImageRotation,
  resetImageRotation,
  rotateImageClockwise,
  rotationFitScale
} from './image-rotation';

describe('normalizeImageRotation', () => {
  it('passes quarter turns through', () => {
    expect(normalizeImageRotation(0)).toBe(0);
    expect(normalizeImageRotation(90)).toBe(90);
    expect(normalizeImageRotation(180)).toBe(180);
    expect(normalizeImageRotation(270)).toBe(270);
  });

  it('falls back to the origin for unsupported values', () => {
    expect(normalizeImageRotation(null)).toBe(0);
    expect(normalizeImageRotation('far')).toBe(0);
    expect(normalizeImageRotation(Number.NaN)).toBe(0);
  });
});

describe('isSidewaysRotation', () => {
  it('reports quarter turns that swap width and height', () => {
    expect(isSidewaysRotation(0)).toBe(false);
    expect(isSidewaysRotation(90)).toBe(true);
    expect(isSidewaysRotation(180)).toBe(false);
    expect(isSidewaysRotation(270)).toBe(true);
  });
});

describe('rotationFitScale', () => {
  it('is neutral for non-sideways rotations', () => {
    expect(rotationFitScale(0, 800, 600, 1600, 1200)).toBe(1);
    expect(rotationFitScale(180, 800, 600, 1600, 1200)).toBe(1);
  });

  it('shrinks a rotated landscape image to fit', () => {
    // Unrotated contain: min(0.5, 0.5) = 0.5; rotated contain: min(800/1200, 600/1600) = 0.375.
    expect(rotationFitScale(90, 800, 600, 1600, 1200)).toBeCloseTo(0.75, 10);
    expect(rotationFitScale(270, 800, 600, 1600, 1200)).toBeCloseTo(0.75, 10);
  });

  it('leaves an already-fitting square image alone', () => {
    expect(rotationFitScale(90, 800, 600, 500, 500)).toBeCloseTo(1, 10);
  });

  it('enlarges a rotated portrait image to fill', () => {
    // Unrotated contain: min(800/600, 600/800) = 0.75; rotated contain: min(800/800, 600/600) = 1.
    expect(rotationFitScale(90, 800, 600, 600, 800)).toBeCloseTo(4 / 3, 10);
  });

  it('falls back to neutral for unknown dimensions', () => {
    expect(rotationFitScale(90, 800, 600, 0, 0)).toBe(1);
    expect(rotationFitScale(90, 0, 0, 1600, 1200)).toBe(1);
  });
});

describe('rotateImageClockwise', () => {
  it('cycles through quarter turns and wraps around', () => {
    resetImageRotation();
    expect(get(imageRotation)).toBe(0);
    rotateImageClockwise();
    expect(get(imageRotation)).toBe(90);
    rotateImageClockwise();
    expect(get(imageRotation)).toBe(180);
    rotateImageClockwise();
    expect(get(imageRotation)).toBe(270);
    rotateImageClockwise();
    expect(get(imageRotation)).toBe(0);
    resetImageRotation();
  });
});
