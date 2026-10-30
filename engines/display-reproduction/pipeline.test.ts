import { describe, it, expect } from 'vitest';
import { simulate, EFFECTS, type Effect } from './pipeline.ts';
import { TARGETS, getTarget } from '../../packages/display-profiles/targets.ts';
import { linearSrgbToOklab, srgbDecode, type Vec3 } from '../../packages/colour-math/index.ts';

const px = (...colours: number[][]) => new Uint8ClampedArray(colours.flatMap(([r, g, b, a = 255]) => [r, g, b, a]));
const rgbAt = (d: Uint8ClampedArray, i: number) => [d[4 * i], d[4 * i + 1], d[4 * i + 2]];
const oklab = (c: number[]) => linearSrgbToOklab(c.map(v => srgbDecode(v / 255)) as Vec3);

// Test image: a coarse RGB lattice covering the cube.
const lattice: number[][] = [];
for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) lattice.push([r, g, b]);
const latticeImg = px(...lattice);

describe('simulate', () => {
  const ref = getTarget('srgb-reference')!;

  it('the ideal sRGB target reproduces the input exactly (absolute and adapted)', () => {
    for (const mode of ['absolute', 'adapted'] as const) {
      const { data, outOfGamutPixels } = simulate(latticeImg, ref, { whiteNits: 80, mode });
      expect(Array.from(data)).toEqual(Array.from(latticeImg));
      expect(outOfGamutPixels).toBe(0);
    }
  });

  it('every target is the identity when all effects are disabled', () => {
    for (const t of TARGETS) {
      const { data } = simulate(latticeImg, t, { whiteNits: null, mode: 'absolute' }, new Set());
      data.forEach((v, i) => expect(Math.abs(v - latticeImg[i]), t.id).toBeLessThanOrEqual(1));
    }
  });

  it('preserves alpha and pixel count (geometry is never touched)', () => {
    const img = px([10, 20, 30, 0], [200, 100, 50, 128]);
    const { data } = simulate(img, getTarget('budget-tn')!, { whiteNits: 400, mode: 'absolute' });
    expect(data.length).toBe(img.length);
    expect([data[3], data[7]]).toEqual([0, 128]);
  });

  it('contrast: raises black to peak/CR and compresses dark distinctions', () => {
    const only = (e: Effect) => new Set<Effect>([e]);
    const t = getTarget('budget-tn')!; // 600:1
    const { data } = simulate(px([0, 0, 0], [20, 20, 20], [30, 30, 30]), t, { whiteNits: null, mode: 'absolute' }, only('contrast'));
    // black: Y = 1/600 → sRGB-encoded ≈ 5.5/255
    expect(data[0]).toBeGreaterThanOrEqual(5); expect(data[0]).toBeLessThanOrEqual(6);
    const dBefore = oklab([30, 30, 30])[0] - oklab([20, 20, 20])[0];
    const dAfter = oklab(rgbAt(data, 2))[0] - oklab(rgbAt(data, 1))[0];
    expect(dAfter).toBeLessThan(dBefore);
  });

  it('luminance: a 200-nit target viewed on a 400-nit display emits half the light', () => {
    const { data } = simulate(px([255, 255, 255]), getTarget('budget-tn')!, { whiteNits: 400, mode: 'absolute' }, new Set(['luminance']));
    expect(srgbDecode(data[0] / 255)).toBeCloseTo(0.5, 2);
  });

  it('luminance is not simulated — with a warning — when the viewer display luminance is unknown', () => {
    const r = simulate(px([255, 255, 255]), getTarget('budget-tn')!, { whiteNits: null, mode: 'absolute' }, new Set(['luminance']));
    expect(r.data[0]).toBe(255);
    expect(r.warnings[0]).toMatch(/luminance unknown/);
  });

  it('bit depth: a 6-bit panel without FRC turns a 256-step ramp into 64 levels', () => {
    const ramp = px(...Array.from({ length: 256 }, (_, i) => [i, i, i]));
    const { data } = simulate(ramp, getTarget('older-ccfl-lcd')!, { whiteNits: null, mode: 'absolute' }, new Set(['bitDepth']));
    expect(new Set(Array.from({ length: 256 }, (_, i) => data[4 * i])).size).toBe(64);
  });

  it('gamut: an unmanaged wide-gamut panel over-saturates sRGB content', () => {
    const muted = [180, 100, 100];
    const { data, outOfGamutPixels } = simulate(px(muted, [255, 0, 0]), getTarget('oled-wide-unmanaged')!, { whiteNits: null, mode: 'absolute' }, new Set(['gamut']));
    const c = (v: number[]) => Math.hypot(oklab(v)[1], oklab(v)[2]);
    expect(c(rgbAt(data, 0))).toBeGreaterThan(c(muted) * 1.1);
    expect(outOfGamutPixels).toBe(1); // pure red becomes P3 red: not showable in sRGB, so it is mapped and counted
  });

  it('gamut: a narrow-gamut panel desaturates sRGB primaries', () => {
    const { data } = simulate(px([0, 200, 0]), getTarget('budget-tn')!, { whiteNits: null, mode: 'absolute' }, new Set(['gamut']));
    const c = (v: number[]) => Math.hypot(oklab(v)[1], oklab(v)[2]);
    expect(c(rgbAt(data, 0))).toBeLessThan(c([0, 200, 0]) * 0.8);
  });

  it('white point: a 9300 K CRT renders white bluish in absolute mode, neutral in adapted mode', () => {
    const t = getTarget('crt-9300k')!;
    const r = simulate(px([255, 255, 255]), t, { whiteNits: null, mode: 'absolute' }, new Set(['whitePoint']));
    const abs = r.data;
    expect(abs[2]).toBe(255); expect(abs[0]).toBeLessThan(abs[2] - 15);
    expect(r.warnings.join()).toMatch(/scaled to/);
    expect(r.outOfGamutPixels).toBe(0); // fitted by scaling, not by clipping
    const adapted = simulate(px([255, 255, 255]), t, { whiteNits: null, mode: 'adapted' }, new Set(['whitePoint'])).data;
    expect(Array.from(adapted.subarray(0, 3))).toEqual([255, 255, 255]);
  });

  it('gamma: a 2.5 CRT darkens mid-tones relative to sRGB', () => {
    const { data } = simulate(px([128, 128, 128]), getTarget('crt-9300k')!, { whiteNits: null, mode: 'absolute' }, new Set(['gamma']));
    expect(data[0]).toBeLessThan(128 - 10);
  });

  it('chroma: a picture-mode gain changes chroma only', () => {
    const t = { ...getTarget('srgb-reference')!, chroma: { value: 0.5, source: 'user' as const, confidence: 'high' as const } };
    const { data } = simulate(px([200, 120, 80]), t, { whiteNits: null, mode: 'absolute' }, new Set(['chroma']));
    const [L0] = oklab([200, 120, 80]), [L1] = oklab(rgbAt(data, 0));
    expect(L1).toBeCloseTo(L0, 2);
  });

  it('every effect name is wired to a parameter', () => {
    for (const e of EFFECTS) {
      const t = getTarget(e === 'bitDepth' ? 'older-ccfl-lcd' : 'crt-9300k')!; // the CRT is 8-bit: no depth loss
      const changed = simulate(latticeImg, { ...t, chroma: { ...t.chroma, value: 0.7 } }, { whiteNits: 400, mode: 'absolute' }, new Set([e])).data;
      expect(Array.from(changed).some((v, i) => Math.abs(v - latticeImg[i]) > 1), e).toBe(true);
    }
  });
});
