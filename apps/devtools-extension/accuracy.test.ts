import { describe, it, expect } from 'vitest';
import { liveAccuracy } from './accuracy.ts';

const img = (w: number, h: number, f: (x: number, y: number) => number) =>
  new Uint8ClampedArray(Array.from({ length: w * h }, (_, k) => { const v = f(k % w, Math.floor(k / w)); return [v, v, v, 255]; }).flat());

describe('liveAccuracy', () => {
  const w = 20, h = 10;
  const original = img(w, h, x => (x < 10 ? 40 : 200));       // two flat areas with an edge between them

  it('is perfect when live equals the exact model', () => {
    const a = liveAccuracy(original, original, original, w);
    expect(a.within2).toBe(1); expect(a.max).toBe(0);
  });

  it('ignores re-rasterised edges but catches real colour errors', () => {
    const edgeOnly = img(w, h, x => (x === 9 || x === 10 ? 128 : x < 10 ? 40 : 200));
    expect(liveAccuracy(original, original, edgeOnly, w).max).toBe(0);
    const wrong = img(w, h, x => (x < 10 ? 40 : 190));          // the bright area is 10 code values off
    const a = liveAccuracy(original, original, wrong, w);
    expect(a.max).toBe(10); expect(a.within2).toBeLessThan(0.6);
  });
});
