// Live mode: compile the same physical model the CPU pipeline uses into an SVG filter graph, so the browser
// applies it on the GPU to the live page (layout, DOM and interaction untouched).
//
//   table  (sRGB-encoded in/out) : signal → (quantise) → tone response, re-encoded with the sRGB curve
//   matrix (linearRGB)           : panel primaries/white → XYZ → luminance & black level → viewer rendering
//
// Browsers keep 8-bit values between filter primitives and evaluate tables in 8 bits, so linear light is never
// stored between steps: tables work on sRGB-encoded values and the matrix asks the browser for linearRGB, which
// it decodes and re-encodes itself. Exact to ~1/255 for 8-bit content except the documented `approximations`.

import { type Vec3, type Mat3, mul, mmul, inv, rgbToXyz, xyToXYZ, bradford, srgbDecode, srgbEncode, SRGB, D65 } from '../../packages/colour-math/index.ts';
import * as st from './stages.ts';
import { whiteFitScale, type Params } from './pipeline.ts';

export type FilterStep =
  | { type: 'table'; values: number[] }   // feComponentTransfer type="table" on sRGB-encoded values
  | { type: 'matrix'; values: number[] }  // feColorMatrix type="matrix", 4×5 row-major, in linearRGB
  | { type: 'saturate'; value: number }   // feColorMatrix type="saturate" on sRGB-encoded values
  | { type: 'luma'; values: number[] };   // feColorMatrix type="matrix" on sRGB-encoded values (monochrome panel)

export interface CompiledFilter { steps: FilterStep[]; approximations: string[] }

const XYZ_TO_SRGB = inv(rgbToXyz(SRGB, D65));
const sample = (n: number, f: (x: number) => number) => Array.from({ length: n }, (_, k) => round6(f(k / (n - 1))));
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
const matrixStep = (m: Mat3, offset: Vec3 = [0, 0, 0]): FilterStep => ({
  type: 'matrix',
  values: [...m[0], 0, offset[0], ...m[1], 0, offset[1], ...m[2], 0, offset[2], 0, 0, 0, 1, 0].map(round6), // rows: R G B A offset
});

export function compileFilter(p: Params): CompiledFilter {
  const steps: FilterStep[] = [];
  const approximations: string[] = [];
  const signalToEncodedLight = (sig: number) => srgbEncode(st.eotf(p.tone, st.quantise([sig, sig, sig], p.bits, p.dithering)[0]));

  if (p.colourManaged) {
    // OS colour management: sRGB → target RGB (relative colorimetric), clipped by the filter, then the panel.
    const toTarget = mmul(inv(rgbToXyz(p.primaries, p.white)), mmul(bradford(xyToXYZ(D65), xyToXYZ(p.white)), rgbToXyz(SRGB, D65)));
    steps.push(matrixStep(toTarget));
    steps.push({ type: 'table', values: sample(256, v => signalToEncodedLight(st.inverseEotf(p.tone, srgbDecode(v)))) });
    // These act on the target-encoded signal, inside the step fused into the table above.
    if (p.chroma !== 1) approximations.push('chroma is not applied live when the OS colour-manages the target — use the preview');
    if (p.monochrome) approximations.push('monochrome is not applied live when the OS colour-manages the target — use the preview');
  } else {
    if (p.chroma !== 1) {
      steps.push({ type: 'saturate', value: round6(p.chroma) });
      approximations.push('chroma uses the browser\'s saturate filter, not OKLab — use Capture for the exact result');
    }
    if (p.monochrome) {
      const [r, g, b] = st.LUMA_601; // exact: luma is linear in the encoded signal
      steps.push({ type: 'luma', values: [r, g, b, 0, 0, r, g, b, 0, 0, r, g, b, 0, 0, 0, 0, 0, 1, 0] });
    }
    steps.push({ type: 'table', values: sample(256, signalToEncodedLight) });
  }

  // Everything after the tone response is linear in light, so stages 5–7 and the white fit fold into one affine map.
  const k = 1 / p.contrast;
  const W = xyToXYZ(p.white);
  const toViewer = p.mode === 'absolute' ? XYZ_TO_SRGB : mmul(XYZ_TO_SRGB, bradford(xyToXYZ(p.white), xyToXYZ(D65)));
  const c = whiteFitScale(p) * (p.mode === 'absolute' ? p.peak / p.viewerWhite : 1);
  const M = mmul(toViewer, rgbToXyz(p.primaries, p.white)).map(row => row.map(v => v * c * (1 - k))) as Mat3;
  const offset = mul(toViewer, W).map(v => v * c * k) as Vec3;
  steps.push(matrixStep(M, offset));
  approximations.push('colours outside sRGB are clipped per channel instead of OKLCh gamut-mapped');
  return { steps, approximations };
}

/** Reference evaluator with browser semantics: 8-bit values between primitives, 8-bit table lookup,
 *  linearRGB primitives decoded/re-encoded by the browser. Used by tests to predict what Chrome renders. */
export function evaluateFilter(f: CompiledFilter, rgb: Vec3): Vec3 {
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const store = (x: number) => Math.round(clamp(x) * 255) / 255;
  let v = rgb.map(x => x / 255) as Vec3;
  for (const s of f.steps) {
    if (s.type === 'table') {
      const n = s.values.length - 1;
      v = v.map(x => { const p = x * n, i = Math.min(Math.floor(p), n - 1); return s.values[i] + (s.values[i + 1] - s.values[i]) * (p - i); }) as Vec3;
    } else if (s.type === 'matrix') {
      const m = s.values, lin = v.map(srgbDecode);
      v = [0, 1, 2].map(r => srgbEncode(clamp(m[5 * r] * lin[0] + m[5 * r + 1] * lin[1] + m[5 * r + 2] * lin[2] + m[5 * r + 4]))) as Vec3;
    } else if (s.type === 'luma') {
      const m = s.values;
      v = [0, 1, 2].map(r => m[5 * r] * v[0] + m[5 * r + 1] * v[1] + m[5 * r + 2] * v[2]) as Vec3;
    } else {
      const a = s.value; // SVG saturate matrix (Filter Effects §9.7)
      const S: Mat3 = [
        [0.213 + 0.787 * a, 0.715 - 0.715 * a, 0.072 - 0.072 * a],
        [0.213 - 0.213 * a, 0.715 + 0.285 * a, 0.072 - 0.072 * a],
        [0.213 - 0.213 * a, 0.715 - 0.715 * a, 0.072 + 0.928 * a],
      ];
      v = mul(S, v) as Vec3;
    }
    v = v.map(store) as Vec3;
  }
  return v.map(x => Math.round(x * 255)) as Vec3;
}
