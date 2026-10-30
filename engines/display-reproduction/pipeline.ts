// Engine 2: Output = F(content, viewer context, target profile).
// The engine never sees a SourceDisplayProfile directly; the caller reduces it to a ViewerContext,
// which keeps Engine 1 and Engine 2 independent.

import type { TargetDisplayProfile } from '../../packages/profile-schema/index.ts';
import { type Vec3, rgbToXyz, xyToXYZ, srgbEncode, mul, inv, SRGB, D65 } from '../../packages/colour-math/index.ts';

const XYZ_TO_SRGB = inv(rgbToXyz(SRGB, D65));
import * as st from './stages.ts';

export const EFFECTS = ['luminance', 'contrast', 'gamut', 'gamma', 'whitePoint', 'bitDepth', 'chroma'] as const;
export type Effect = (typeof EFFECTS)[number];

export interface ViewerContext {
  /** Luminance of the viewer's (source) display white, cd/m². null = unknown → luminance is not simulated. */
  whiteNits: number | null;
  mode: 'absolute' | 'adapted';
}

export interface SimulationResult { data: Uint8ClampedArray; outOfGamutPixels: number; warnings: string[] }

/** Resolved physical parameters. A disabled effect falls back to the ideal sRGB reference display. */
export function resolveParams(t: TargetDisplayProfile, ctx: ViewerContext, enabled: ReadonlySet<Effect> = new Set(EFFECTS)) {
  const on = (e: Effect) => enabled.has(e);
  const warnings: string[] = [];
  const peak = t.luminance.value ?? 0;
  let viewerWhite = ctx.whiteNits;
  if (viewerWhite == null && on('luminance') && ctx.mode === 'absolute') {
    warnings.push('viewer display luminance unknown: luminance difference not simulated (enter your display\'s nits to enable it)');
  }
  if (viewerWhite == null || !on('luminance')) viewerWhite = peak; // compare like with like
  const p = {
    colourManaged: t.colourManaged,
    peak,
    viewerWhite,
    contrast: on('contrast') ? t.contrastRatio.value ?? Infinity : Infinity,
    primaries: on('gamut') ? t.primaries.value ?? SRGB : SRGB,
    white: on('whitePoint') ? t.whitePoint.value ?? D65 : D65,
    tone: (on('gamma') ? t.toneResponse.value : null) ?? { type: 'srgb' as const },
    bits: on('bitDepth') ? t.bitDepth.value ?? 8 : 8,
    dithering: on('bitDepth') ? t.dithering : 'none' as const,
    chroma: on('chroma') ? t.chroma.value ?? 1 : 1,
    mode: ctx.mode,
  };
  return { p, warnings };
}

export type Params = ReturnType<typeof resolveParams>['p'];

/** Absolute mode can ask for a white the viewer cannot emit (a 9300 K white needs blue > 1 on a D65
 *  display, or the target is simply brighter). Like ICC absolute-colorimetric proofing, scale the whole
 *  image once so the target white fits, keeping every chromaticity and luminance ratio intact. */
export function whiteFitScale(p: Params): number {
  const w = st.renderForViewer(xyToXYZ(p.white, p.peak), p.mode, p.viewerWhite, p.white, p.peak);
  return 1 / Math.max(1, ...mul(XYZ_TO_SRGB, w));
}

/** One colour through the whole chain: 8-bit sRGB in, [8-bit sRGB out, out-of-gamut flag]. */
export function makeColourTransform(p: Params) {
  const m = rgbToXyz(p.primaries, p.white);
  const whiteXYZ = xyToXYZ(p.white);
  const scale = whiteFitScale(p);
  return (r: number, g: number, b: number): [Vec3, boolean] => {
    let s: Vec3 = [r / 255, g / 255, b / 255];
    if (p.colourManaged) s = st.osColourManagement(s, p.primaries, p.white, p.tone);
    s = st.chroma(s, p.chroma);
    s = st.quantise(s, p.bits, p.dithering);
    const xyz = st.panelColorimetry(st.toneResponse(s, p.tone), m);
    const abs = st.luminanceAndBlack(xyz, whiteXYZ, p.peak, p.contrast);
    const view = st.renderForViewer(abs, p.mode, p.viewerWhite, p.white, p.peak).map(v => v * scale) as Vec3;
    const [lin, mapped] = st.gamutMapToSrgb(view);
    return [lin.map(v => Math.round(srgbEncode(v) * 255)) as Vec3, mapped];
  };
}

/** Transforms RGBA pixels (sRGB-encoded, e.g. ImageData or a decoded PNG). Alpha and geometry untouched. */
export function simulate(rgba: Uint8Array | Uint8ClampedArray, target: TargetDisplayProfile, ctx: ViewerContext, enabled?: ReadonlySet<Effect>): SimulationResult {
  const { p, warnings } = resolveParams(target, ctx, enabled);
  const scale = whiteFitScale(p);
  if (scale < 0.995) warnings.push(`target white cannot be shown on the viewer display at full level; whole image scaled to ${(scale * 100).toFixed(1)}% to keep colours in proportion`);
  const f = makeColourTransform(p);
  const cache = new Map<number, number>(); // packed rgb → packed rgb | out-of-gamut bit
  const out = new Uint8ClampedArray(rgba.length);
  let outOfGamut = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    let v = cache.get(key);
    if (v === undefined) {
      const [[r, g, b], mapped] = f(rgba[i], rgba[i + 1], rgba[i + 2]);
      v = (r << 16) | (g << 8) | b | (mapped ? 1 << 24 : 0);
      cache.set(key, v);
    }
    out[i] = (v >> 16) & 255; out[i + 1] = (v >> 8) & 255; out[i + 2] = v & 255; out[i + 3] = rgba[i + 3];
    if (v >> 24) outOfGamut++;
  }
  return { data: out, outOfGamutPixels: outOfGamut, warnings };
}
