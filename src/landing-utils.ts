/** Convert a ScrollTrigger progress value into a safe media time. */
export function mediaTimeForProgress(progress: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  return clamped * duration;
}

export function shouldSeek(currentTime: number, targetTime: number, threshold = 0.02): boolean {
  return Number.isFinite(targetTime) && Math.abs(currentTime - targetTime) >= threshold;
}

export function shouldHideHeroInterface(progress: number): boolean {
  return progress >= 0.8;
}
