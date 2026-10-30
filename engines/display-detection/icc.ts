// Minimal ICC (v2 and v4) reader for RGB display profiles: just the tags that describe a matrix/TRC display.
// Reference: ICC.1:2022 (v4.4) and ICC.1:2001-04 (v2).

import type { XY, Primaries, ToneResponse } from '../../packages/profile-schema/index.ts';
import { type Mat3, type Vec3, mul, inv, bradford, XYZtoxy, D50_ICC } from '../../packages/colour-math/index.ts';

export interface IccInfo {
  version: string;
  deviceClass: string;
  colourSpace: string;
  pcs: string;
  description: string | null;
  /** Native (un-adapted) chromaticities. Null when the profile is not matrix/TRC (e.g. LUT-only). */
  primaries: Primaries | null;
  whitePoint: XY | null;
  toneResponse: ToneResponse | null;   // green channel, the luminance-dominant one
  trcsDiffer: boolean;
  luminance: number | null;            // 'lumi' tag, cd/m²
}

const PARA_COUNTS = [1, 3, 4, 5, 7];

export function parseIcc(buf: Uint8Array): IccInfo {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const str = (o: number, n: number) => String.fromCharCode(...buf.subarray(o, o + n));
  if (buf.length < 132 || str(36, 4) !== 'acsp') throw new Error('not an ICC profile');
  const s15 = (o: number) => dv.getInt32(o) / 65536;

  const tags = new Map<string, { off: number; size: number }>();
  const n = dv.getUint32(128);
  for (let i = 0; i < n; i++) {
    const t = 132 + 12 * i;
    const off = dv.getUint32(t + 4), size = dv.getUint32(t + 8);
    if (off + size > buf.length) throw new Error(`ICC tag ${str(t, 4)} out of bounds`);
    tags.set(str(t, 4), { off, size });
  }
  const xyz = (sig: string): Vec3 | null => {
    const t = tags.get(sig);
    return t && str(t.off, 4) === 'XYZ ' ? [s15(t.off + 8), s15(t.off + 12), s15(t.off + 16)] : null;
  };

  const trc = (sig: string): { tr: ToneResponse; f: (x: number) => number } | null => {
    const t = tags.get(sig);
    if (!t) return null;
    const o = t.off, type = str(o, 4);
    if (type === 'curv') {
      const count = dv.getUint32(o + 8);
      if (count === 0) return { tr: { type: 'gamma', gamma: 1 }, f: x => x };
      if (count === 1) { const g = dv.getUint16(o + 12) / 256; return { tr: { type: 'gamma', gamma: g }, f: x => x ** g }; }
      const pts = Array.from({ length: count }, (_, i) => dv.getUint16(o + 12 + 2 * i) / 65535);
      const f = (x: number) => { const p = x * (count - 1), i = Math.min(Math.floor(p), count - 2); return pts[i] + (pts[i + 1] - pts[i]) * (p - i); };
      return { tr: { type: 'table', points: count, approxGamma: fitGamma(f) }, f };
    }
    if (type === 'para') {
      const fn = dv.getUint16(o + 8);
      const p = Array.from({ length: PARA_COUNTS[fn] ?? 0 }, (_, i) => s15(o + 12 + 4 * i));
      if (!p.length) throw new Error(`unsupported para function ${fn}`);
      const [g, a = 1, b = 0, c = 0, d = 0, e = 0, f0 = 0] = p;
      const f = [
        (x: number) => x ** g,
        (x: number) => (x >= -b / a ? (a * x + b) ** g : 0),
        (x: number) => (x >= -b / a ? (a * x + b) ** g + c : c),
        (x: number) => (x >= d ? (a * x + b) ** g : c * x),
        (x: number) => (x >= d ? (a * x + b) ** g + e : c * x + f0),
      ][fn];
      return { tr: { type: 'parametric', params: p, approxGamma: fitGamma(f) }, f };
    }
    return null; // e.g. LUT-based profiles
  };

  // Native chromaticities: undo the adaptation to the D50 PCS. v4 (and many v2) profiles carry
  // 'chad'; older v2 profiles store native white in 'wtpt' and Bradford-adapted colorants.
  const ct = tags.get('chad');
  const wtpt = xyz('wtpt');
  let toNative: Mat3 | null = null;
  if (ct) toNative = inv([0, 1, 2].map(r => [0, 1, 2].map(c => s15(ct.off + 8 + 4 * (3 * r + c)))) as Mat3);
  else if (wtpt && Math.abs(wtpt[0] - D50_ICC[0]) + Math.abs(wtpt[2] - D50_ICC[2]) > 0.002) toNative = bradford(D50_ICC, wtpt);
  const native = (v: Vec3 | null) => (v ? XYZtoxy(toNative ? mul(toNative, v) : v) : null);

  const r = native(xyz('rXYZ')), g = native(xyz('gXYZ')), b = native(xyz('bXYZ'));
  const white = native(wtpt);
  const [tr, tg, tb] = ['rTRC', 'gTRC', 'bTRC'].map(trc);
  const differ = !!(tr && tg && tb) && [0.1, 0.5, 0.9].some(x => Math.abs(tr.f(x) - tg.f(x)) + Math.abs(tb.f(x) - tg.f(x)) > 1e-3);

  return {
    version: `${buf[8]}.${buf[9] >> 4}.${buf[9] & 15}`,
    deviceClass: str(12, 4).trim(),
    colourSpace: str(16, 4).trim(),
    pcs: str(20, 4).trim(),
    description: readText(tags.get('desc'), buf, dv),
    primaries: r && g && b ? { red: r, green: g, blue: b } : null,
    whitePoint: white,
    toneResponse: tg?.tr ?? null,
    trcsDiffer: differ,
    luminance: xyz('lumi')?.[1] ?? null,
  };
}

/** Least-squares single gamma over mid-range samples: log y = γ log x. */
export function fitGamma(f: (x: number) => number): number {
  let num = 0, den = 0;
  for (let x = 0.1; x <= 0.9001; x += 0.05) { const lx = Math.log(x), ly = Math.log(f(x)); num += lx * ly; den += lx * lx; }
  return Math.round((num / den) * 1000) / 1000;
}

function readText(t: { off: number; size: number } | undefined, buf: Uint8Array, dv: DataView): string | null {
  if (!t) return null;
  const type = String.fromCharCode(...buf.subarray(t.off, t.off + 4));
  if (type === 'desc') { const len = dv.getUint32(t.off + 8); return new TextDecoder('latin1').decode(buf.subarray(t.off + 12, t.off + 12 + len)).replace(/\0+$/, ''); }
  if (type === 'mluc') {
    const len = dv.getUint32(t.off + 20), off = dv.getUint32(t.off + 24);
    return new TextDecoder('utf-16be').decode(buf.subarray(t.off + off, t.off + off + len));
  }
  return null;
}
