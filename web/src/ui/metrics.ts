import { signal } from '@preact/signals';

/** Pixels per rem. The whole UI is laid out in rem against a 1920x1080 canvas. */
export const remPx = signal(16);
export const viewport = signal({ w: 1920, h: 1080 });

export function measure(): void {
  const w = window.innerWidth || 1920;
  const h = window.innerHeight || 1080;
  // Fit a 16:9 canvas; 120rem wide, 67.5rem tall.
  const px = Math.min(w / 120, h / 67.5);
  document.documentElement.style.fontSize = px + 'px';
  remPx.value = px;
  viewport.value = { w, h };
}

export function initMetrics(): void {
  measure();
  window.addEventListener('resize', measure);
}

export const SAFE_X = 5; // rem (80px at 1080p)
export const SAFE_Y = 3.75; // rem (60px at 1080p)
