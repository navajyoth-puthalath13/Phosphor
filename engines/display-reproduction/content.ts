// Stage 0 — content acquisition: bring an image tagged with some RGB colour space into sRGB, the encoding
// the rest of the pipeline assumes. macOS screenshots, for example, are tagged with the display's own
// profile (Display P3 on most Macs). Relative colorimetric: the source white becomes D65.

import type { Primaries, XY } from '../../packages/profile-schema/index.ts';
import { type Vec3, mul, mmul, rgbToXyz, bradford, xyToXYZ, srgbEncode, SRGB, D65 } from '../../packages/colour-math/index.ts';
import { gamutMapToSrgb } from './stages.ts';

export interface ContentSpace {
  primaries: Primaries;
  white: XY;
  curves: [(x: number) => number, (x: number) => number, (x: number) => number];
}

/** Returns sRGB-encoded RGBA pixels (alpha untouched) and how many colours needed gamut mapping. */
export function contentToSrgb(rgba: Uint8Array | Uint8ClampedArray, space: ContentSpace) {
  const toXyz = mmul(bradford(xyToXYZ(space.white), xyToXYZ(D65)), rgbToXyz(space.primaries, space.white));
  const cache = new Map<number, number>();
  const out = new Uint8ClampedArray(rgba.length);
  let mapped = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    let v = cache.get(key);
    if (v === undefined) {
      const lin = [0, 1, 2].map(c => space.curves[c](rgba[i + c] / 255)) as Vec3;
      const [srgb, wasMapped] = gamutMapToSrgb(mul(toXyz, lin));
      const [r, g, b] = srgb.map(x => Math.round(srgbEncode(x) * 255));
      v = (r << 16) | (g << 8) | b | (wasMapped ? 1 << 24 : 0);
      cache.set(key, v);
    }
    out[i] = (v >> 16) & 255; out[i + 1] = (v >> 8) & 255; out[i + 2] = v & 255; out[i + 3] = rgba[i + 3];
    if (v >> 24) mapped++;
  }
  return { data: out, outOfGamutPixels: mapped };
}

/** True when converting would be a no-op (already sRGB within rounding). */
export const isSrgbLike = (s: ContentSpace) =>
  (['red', 'green', 'blue'] as const).every(k => Math.abs(s.primaries[k].x - SRGB[k].x) + Math.abs(s.primaries[k].y - SRGB[k].y) < 0.002)
  && Math.abs(s.white.x - D65.x) + Math.abs(s.white.y - D65.y) < 0.002;
