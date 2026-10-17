import { describe, expect, it } from 'vitest';
import { mediaTimeForProgress, shouldHideHeroInterface, shouldSeek } from './landing-utils';

describe('cinematic hero scroll mapping', () => {
  it('maps progress forward and backward across the video duration', () => {
    expect(mediaTimeForProgress(0, 10)).toBe(0);
    expect(mediaTimeForProgress(0.5, 10)).toBe(5);
    expect(mediaTimeForProgress(0.25, 10)).toBe(2.5);
    expect(mediaTimeForProgress(1, 10)).toBe(10);
  });

  it('clamps progress and safely handles unavailable metadata', () => {
    expect(mediaTimeForProgress(-1, 10)).toBe(0);
    expect(mediaTimeForProgress(2, 10)).toBe(10);
    expect(mediaTimeForProgress(0.5, 0)).toBe(0);
    expect(mediaTimeForProgress(Number.NaN, 10)).toBe(0);
  });

  it('skips negligible seeks and permits responsive reverse seeks', () => {
    expect(shouldSeek(2, 2.01)).toBe(false);
    expect(shouldSeek(2, 1.5)).toBe(true);
    expect(shouldSeek(2, 2.02)).toBe(true);
  });

  it('hides all hero branding during the baked-in title ending', () => {
    expect(shouldHideHeroInterface(0.79)).toBe(false);
    expect(shouldHideHeroInterface(0.8)).toBe(true);
    expect(shouldHideHeroInterface(1)).toBe(true);
  });
});
