import { describe, it, expect } from 'vitest';
import * as st from './stages.ts';
import { SRGB, DISPLAY_P3, D65, rgbToXyz, xyToXYZ, linearSrgbToOklab, mul, inv, srgbDecode, type Vec3 } from '../../packages/colour-math/index.ts';

const close = (a: number[], b: number[], d = 4) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], d));
const srgbTone = { type: 'srgb' as const };

describe('stage 1: OS colour management', () => {
  it('is the identity into an sRGB display', () => close(st.osColourManagement([0.2, 0.5, 0.9], SRGB, D65, srgbTone), [0.2, 0.5, 0.9], 6));
  it('maps sRGB red to the CSS Color 4 Display P3 value', () =>
    close(st.osColourManagement([1, 0, 0], DISPLAY_P3, D65, srgbTone), [0.9175, 0.2003, 0.1386], 3));
});

describe('stage 2: chroma', () => {
  const lab = (s: Vec3) => linearSrgbToOklab(s.map(srgbDecode) as Vec3);
  it('gain 1 is the identity', () => expect(st.chroma([0.3, 0.6, 0.2], 1)).toEqual([0.3, 0.6, 0.2]));
  it('gain 0 gives a neutral of the same OKLab lightness', () => {
    const [L] = lab([0.3, 0.6, 0.2]);
    const out = st.chroma([0.3, 0.6, 0.2], 0);
    expect(lab(out)[0]).toBeCloseTo(L, 4);
    expect(Math.hypot(lab(out)[1], lab(out)[2])).toBeLessThan(1e-4);
  });
  it('gain 0.5 halves OKLab chroma and keeps hue', () => {
    const [, a, b] = lab([0.6, 0.45, 0.4]);
    const [, a2, b2] = lab(st.chroma([0.6, 0.45, 0.4], 0.5));
    expect(Math.hypot(a2, b2)).toBeCloseTo(Math.hypot(a, b) / 2, 4);
    expect(Math.atan2(b2, a2)).toBeCloseTo(Math.atan2(b, a), 3);
  });
});

describe('stage 3: quantisation', () => {
  const ramp = Array.from({ length: 256 }, (_, i) => i / 255);
  const levels = (bits: number, d: 'none' | 'frc') => new Set(ramp.map(v => st.quantise([v, v, v], bits, d)[0])).size;
  it('6-bit without FRC leaves 64 levels', () => expect(levels(6, 'none')).toBe(64));
  it('6-bit + FRC averages to 8-bit', () => expect(levels(6, 'frc')).toBe(256));
  it('8-bit is lossless for 8-bit content', () => ramp.forEach(v => expect(st.quantise([v, v, v], 8, 'none')[0]).toBeCloseTo(v, 12)));
});

describe('stage 4: tone response', () => {
  it('gamma 2.2 at mid signal', () => expect(st.toneResponse([0.5, 0.5, 0.5], { type: 'gamma', gamma: 2.2 })[0]).toBeCloseTo(0.21764, 5));
  it('sRGB curve at mid signal', () => expect(st.toneResponse([0.5, 0.5, 0.5], srgbTone)[0]).toBeCloseTo(0.21404, 5));
});

describe('stages 5–6: colorimetry, luminance and black', () => {
  const m = rgbToXyz(SRGB, D65), W = xyToXYZ(D65);
  it('white reaches peak luminance, black reaches peak/CR', () => {
    expect(st.luminanceAndBlack(st.panelColorimetry([1, 1, 1], m), W, 250, 1000)[1]).toBeCloseTo(250, 6);
    expect(st.luminanceAndBlack(st.panelColorimetry([0, 0, 0], m), W, 250, 1000)[1]).toBeCloseTo(0.25, 6);
  });
  it('infinite contrast leaves black at zero', () =>
    expect(st.luminanceAndBlack([0, 0, 0], W, 250, Infinity)).toEqual([0, 0, 0]));
});

describe('stage 7: viewer rendering', () => {
  const warm = { x: 0.3457, y: 0.3585 }; // D50
  it('absolute mode keeps cd/m² relative to the viewer white', () =>
    expect(st.renderForViewer([0, 100, 0], 'absolute', 400, D65, 200)[1]).toBeCloseTo(0.25, 9));
  it('adapted mode maps the target white to D65 at Y=1', () =>
    close(st.renderForViewer(xyToXYZ(warm, 200), 'adapted', 400, warm, 200), xyToXYZ(D65), 4));
});

describe('stage 8: gamut mapping', () => {
  it('leaves in-gamut colours alone', () => {
    const [rgb, mapped] = st.gamutMapToSrgb(rgbToXyz(SRGB, D65).map(r => r[0] * 0.2 + r[1] * 0.5 + r[2] * 0.7) as Vec3);
    close(rgb, [0.2, 0.5, 0.7], 6); expect(mapped).toBe(false);
  });
  it('brings Display P3 green into sRGB at constant OKLab lightness and hue', () => {
    const p3green = rgbToXyz(DISPLAY_P3, D65).map(r => r[1]) as Vec3;
    const [rgb, mapped] = st.gamutMapToSrgb(p3green);
    expect(mapped).toBe(true);
    rgb.forEach(v => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); });
    const before = linearSrgbToOklab(mul(inv(rgbToXyz(SRGB, D65)), p3green));
    const after = linearSrgbToOklab(rgb);
    expect(after[0]).toBeCloseTo(before[0], 2);
    expect(Math.atan2(after[2], after[1])).toBeCloseTo(Math.atan2(before[2], before[1]), 1);
  });
});
