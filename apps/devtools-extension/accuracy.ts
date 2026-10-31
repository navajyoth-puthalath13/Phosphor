// Compares what live mode actually put on screen with the exact model, from two captures of the same page.
// Text and shape edges re-rasterise under a filter (anti-aliasing changes, not colour), so they are excluded.

export interface Accuracy { within2: number; p99: number; max: number; compared: number }

export function liveAccuracy(original: Uint8ClampedArray, exact: Uint8ClampedArray, live: Uint8ClampedArray, width: number): Accuracy {
  const diffs: number[] = [];
  const edge = (i: number) => [4, -4, 4 * width, -4 * width].some(o => {
    const j = i + o;
    return j >= 0 && j < original.length && Math.abs(original[i] - original[j]) + Math.abs(original[i + 1] - original[j + 1]) + Math.abs(original[i + 2] - original[j + 2]) > 24;
  });
  for (let i = 0; i < original.length; i += 4) {
    if (edge(i)) continue;
    diffs.push(Math.max(Math.abs(exact[i] - live[i]), Math.abs(exact[i + 1] - live[i + 1]), Math.abs(exact[i + 2] - live[i + 2])));
  }
  diffs.sort((a, b) => a - b);
  const n = diffs.length;
  return { within2: n ? diffs.filter(d => d <= 2).length / n : 1, p99: n ? diffs[Math.floor(n * 0.99)] : 0, max: n ? diffs[n - 1] : 0, compared: n };
}
