// Engine 2 stages, in physical signal-flow order. Each is a pure function on one colour so it can be
// tested against reference values on its own. See docs/display-model.md for the model and its limits.

import type { Primaries, XY } from '../../packages/profile-schema/index.ts';
import {
  type Vec3, type Mat3, mul, inv, rgbToXyz, bradford, xyToXYZ, srgbDecode, srgbEncode,
  linearSrgbToOklab, oklabToLinearSrgb, SRGB, D65,
} from '../../packages/colour-math/index.ts';

export type Tone = { type: 'srgb' } | { type: 'gamma'; gamma: number };

const XYZ_TO_SRGB = inv(rgbToXyz(SRGB, D65));
const SRGB_TO_XYZ = rgbToXyz(SRGB, D65);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const clip = (v: Vec3): Vec3 => [clamp01(v[0]), clamp01(v[1]), clamp01(v[2])];

export const eotf = (t: Tone, v: number) => (t.type === 'srgb' ? srgbDecode(v) : v ** t.gamma);
export const inverseEotf = (t: Tone, v: number) => (t.type === 'srgb' ? srgbEncode(v) : v ** (1 / t.gamma));

/** Stage 1 — OS colour management (relative colorimetric, as ColorSync/Windows ICM do): sRGB content is
 *  converted into the target's own RGB and clipped. Unmanaged targets get the sRGB values untouched. */
export function osColourManagement(signal: Vec3, p: Primaries, white: XY, tone: Tone): Vec3 {
  const lin = signal.map(srgbDecode) as Vec3;
  const adapted = mul(bradford(xyToXYZ(D65), xyToXYZ(white)), mul(SRGB_TO_XYZ, lin));
  return clip(mul(inv(rgbToXyz(p, white)), adapted)).map(v => inverseEotf(tone, v)) as Vec3;
}

/** Stage 2 — picture-mode saturation in OKLab: scales chroma at constant lightness and hue. */
export function chroma(signal: Vec3, gain: number): Vec3 {
  if (gain === 1) return signal;
  const [L, a, b] = linearSrgbToOklab(signal.map(srgbDecode) as Vec3);
  return clip(oklabToLinearSrgb([L, a * gain, b * gain])).map(srgbEncode) as Vec3;
}

/** Stage 2b — monochrome panel: one value per pixel from Rec. 601 luma on the encoded signal (ITU-R BT.601),
 *  the conversion monochrome monitors and grey-scale video use. Unlike OKLab lightness, blue comes out dark. */
export const LUMA_601 = [0.299, 0.587, 0.114] as const;
export const luma = (signal: Vec3): Vec3 => { const y = LUMA_601[0] * signal[0] + LUMA_601[1] * signal[1] + LUMA_601[2] * signal[2]; return [y, y, y]; };

/** Stage 3 — panel quantisation. FRC is modelled by its time-average: +2 effective bits. A static
 *  frame cannot show FRC flicker, and drawing spatial noise instead would be a decorative effect. */
export function quantise(signal: Vec3, bits: number, dithering: 'none' | 'frc'): Vec3 {
  const levels = 2 ** (dithering === 'frc' ? bits + 2 : bits) - 1;
  return signal.map(v => Math.round(v * levels) / levels) as Vec3;
}

/** Stage 4 — tone response: drive signal → relative channel light output. */
export const toneResponse = (signal: Vec3, t: Tone): Vec3 => signal.map(v => eotf(t, v)) as Vec3;

/** Stage 5 — panel colorimetry: linear channel output → XYZ through the panel's own primaries and white. */
export const panelColorimetry = (lin: Vec3, m: Mat3): Vec3 => mul(m, lin);

/** Stage 6 — luminance and black level. Additive black (same chromaticity as white, e.g. LCD leakage):
 *  XYZ = Lw·((1−k)·XYZrel + k·Wrel), k = 1/CR. Returns absolute XYZ in cd/m². */
export function luminanceAndBlack(xyzRel: Vec3, whiteXYZ: Vec3, peak: number, contrast: number): Vec3 {
  const k = 1 / contrast;
  return xyzRel.map((v, i) => peak * ((1 - k) * v + k * whiteXYZ[i])) as Vec3;
}

/** Stage 7 — what the viewer's display must emit. 'absolute': same cd/m² and chromaticity as the target
 *  (relative to the viewer's reference white). 'adapted': the eye adapts to the target's white and peak. */
export function renderForViewer(xyzAbs: Vec3, mode: 'absolute' | 'adapted', viewerWhiteNits: number, targetWhite: XY, peak: number): Vec3 {
  if (mode === 'absolute') return xyzAbs.map(v => v / viewerWhiteNits) as Vec3;
  return mul(bradford(xyToXYZ(targetWhite), xyToXYZ(D65)), xyzAbs.map(v => v / peak) as Vec3);
}

/** Stage 8 — gamut mapping into the output space (sRGB): CSS Color 4 style — reduce OKLCh chroma at
 *  constant lightness and hue until in gamut, then clip the remainder. Returns [linear sRGB, wasMapped]. */
export function gamutMapToSrgb(xyz: Vec3): [Vec3, boolean] {
  const rgb = mul(XYZ_TO_SRGB, xyz);
  const eps = 1e-6;
  if (rgb.every(v => v >= -eps && v <= 1 + eps)) return [clip(rgb), false];
  const [L, a, b] = linearSrgbToOklab(rgb);
  if (L >= 1) return [[1, 1, 1], true];
  if (L <= 0) return [[0, 0, 0], true];
  const inGamut = (s: number) => oklabToLinearSrgb([L, a * s, b * s]).every(v => v >= -eps && v <= 1 + eps);
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (inGamut(mid)) lo = mid; else hi = mid; }
  return [clip(oklabToLinearSrgb([L, a * lo, b * lo])), true];
}
