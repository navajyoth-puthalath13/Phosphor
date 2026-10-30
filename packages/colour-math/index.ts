// Small colour-science kernel shared by both engines. Constants are from the cited standards;
// every function is checked against published reference values in index.test.ts.

import type { XY, Primaries } from '../profile-schema/index.ts';

export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3];

export const mul = (m: Mat3, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

export const mmul = (a: Mat3, b: Mat3): Mat3 =>
  [0, 1, 2].map(i => [0, 1, 2].map(j => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j])) as Mat3;

export function inv(m: Mat3): Mat3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error('singular matrix');
  return [
    [A / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [C / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

// CIE standard illuminants as xy (CIE 15:2004), and the ICC PCS illuminant (ICC.1:2022 §7.2.16).
export const D65: XY = { x: 0.3127, y: 0.3290 };
export const D50_ICC: Vec3 = [0.9642, 1, 0.8249];

export const SRGB: Primaries = { red: { x: 0.64, y: 0.33 }, green: { x: 0.30, y: 0.60 }, blue: { x: 0.15, y: 0.06 } };
export const DISPLAY_P3: Primaries = { red: { x: 0.680, y: 0.320 }, green: { x: 0.265, y: 0.690 }, blue: { x: 0.150, y: 0.060 } };
export const ADOBE_RGB: Primaries = { red: { x: 0.64, y: 0.33 }, green: { x: 0.21, y: 0.71 }, blue: { x: 0.15, y: 0.06 } };
export const REC2020: Primaries = { red: { x: 0.708, y: 0.292 }, green: { x: 0.170, y: 0.797 }, blue: { x: 0.131, y: 0.046 } };
export const NTSC1953: Primaries = { red: { x: 0.67, y: 0.33 }, green: { x: 0.21, y: 0.71 }, blue: { x: 0.14, y: 0.08 } };

export const xyToXYZ = ({ x, y }: XY, Y = 1): Vec3 => [(x / y) * Y, Y, ((1 - x - y) / y) * Y];
export const XYZtoxy = ([X, Y, Z]: Vec3): XY => ({ x: X / (X + Y + Z), y: Y / (X + Y + Z) });

/** Linear RGB → XYZ for an additive display with the given primaries; white maps to Y = 1. */
export function rgbToXyz(p: Primaries, white: XY): Mat3 {
  const cols = [p.red, p.green, p.blue].map(c => xyToXYZ(c));
  const P: Mat3 = [0, 1, 2].map(r => cols.map(c => c[r])) as Mat3;
  const S = mul(inv(P), xyToXYZ(white));
  return P.map(row => row.map((v, j) => v * S[j])) as Mat3;
}

const BRADFORD: Mat3 = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
/** Bradford chromatic adaptation from one white (XYZ) to another. */
export function bradford(from: Vec3, to: Vec3): Mat3 {
  const s = mul(BRADFORD, from), d = mul(BRADFORD, to);
  const D: Mat3 = [[d[0] / s[0], 0, 0], [0, d[1] / s[1], 0], [0, 0, d[2] / s[2]]];
  return mmul(inv(BRADFORD), mmul(D, BRADFORD));
}

// IEC 61966-2-1 sRGB transfer function.
export const srgbDecode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export const srgbEncode = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

// OKLab (Ottosson 2020, CSS Color 4 matrices), from linear sRGB.
const LMS: Mat3 = [[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]];
const LAB: Mat3 = [[0.2104542553, 0.7936177850, -0.0040720468], [1.9779984951, -2.4285922050, 0.4505937099], [0.0259040371, 0.7827717662, -0.8086757660]];
const LMS_INV = inv(LMS), LAB_INV = inv(LAB);
export const linearSrgbToOklab = (rgb: Vec3): Vec3 => mul(LAB, mul(LMS, rgb).map(Math.cbrt) as Vec3);
export const oklabToLinearSrgb = (lab: Vec3): Vec3 => mul(LMS_INV, mul(LAB_INV, lab).map(v => v * v * v) as Vec3);

/** Area of the xy triangle, used for "% of NTSC/sRGB" style gamut-size comparisons. */
export const gamutArea = ({ red: r, green: g, blue: b }: Primaries) =>
  Math.abs(r.x * (g.y - b.y) + g.x * (b.y - r.y) + b.x * (r.y - g.y)) / 2;

/** Approximate CCT (K) from xy — McCamy 1992; valid roughly 2000–12500 K near the Planckian locus. */
export function cctFromXY({ x, y }: XY) {
  const n = (x - 0.3320) / (0.1858 - y);
  return 449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33;
}

/** xy of a daylight-series illuminant at the given CCT (CIE 15:2004 §3.1), valid 4000–25000 K. */
export function daylightXY(cct: number): XY {
  const t = cct, x = t <= 7000
    ? -4.607e9 / t ** 3 + 2.9678e6 / t ** 2 + 0.09911e3 / t + 0.244063
    : -2.0064e9 / t ** 3 + 1.9018e6 / t ** 2 + 0.24748e3 / t + 0.23704;
  return { x, y: -3 * x * x + 2.87 * x - 0.275 };
}
