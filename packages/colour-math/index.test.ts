import { describe, it, expect } from 'vitest';
import * as c from './index.ts';

const close = (a: number[], b: number[], d = 4) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], d));

describe('colour-math reference values', () => {
  it('derives the IEC 61966-2-1 sRGB→XYZ matrix', () => {
    const m = c.rgbToXyz(c.SRGB, c.D65);
    close(m[0], [0.4124, 0.3576, 0.1805]);
    close(m[1], [0.2126, 0.7152, 0.0722]);
    close(m[2], [0.0193, 0.1192, 0.9505]);
  });

  it('round-trips the sRGB transfer function and hits its knee', () => {
    expect(c.srgbDecode(0.04045)).toBeCloseTo(0.0031308, 6);
    for (const v of [0, 0.01, 0.2, 0.5, 0.9, 1]) expect(c.srgbEncode(c.srgbDecode(v))).toBeCloseTo(v, 10);
    expect(c.srgbDecode(0.5)).toBeCloseTo(0.214041, 5);
  });

  it('matches the Lindbloom Bradford D65→D50 matrix', () => {
    const m = c.bradford(c.xyToXYZ({ x: 0.31271, y: 0.32902 }), c.xyToXYZ({ x: 0.34567, y: 0.35850 }));
    close(m[0], [1.0478112, 0.0228866, -0.0501270], 3);
    close(m[1], [0.0295424, 0.9904844, -0.0170491], 3);
    close(m[2], [-0.0092345, 0.0150436, 0.7521316], 3);
  });

  it('reproduces OKLab reference values (Ottosson)', () => {
    close(c.linearSrgbToOklab([1, 1, 1]), [1, 0, 0], 3);
    // pure sRGB red → OKLab (0.62796, 0.22486, 0.12585), CSS Color 4 sample
    close(c.linearSrgbToOklab([1, 0, 0]), [0.62796, 0.22486, 0.12585], 3);
    close(c.oklabToLinearSrgb(c.linearSrgbToOklab([0.2, 0.5, 0.7])), [0.2, 0.5, 0.7], 9);
  });

  it('computes gamut areas and colour temperatures', () => {
    expect(c.gamutArea(c.SRGB) / c.gamutArea(c.NTSC1953)).toBeCloseTo(0.71, 2); // the familiar "sRGB ≈ 72% NTSC"
    expect(c.cctFromXY(c.D65)).toBeCloseTo(6504, -1);
    const d65 = c.daylightXY(6504);
    expect(d65.x).toBeCloseTo(0.3127, 3); expect(d65.y).toBeCloseTo(0.3290, 3);
    // McCamy's cubic drifts ~1% at 9300 K; that is the published accuracy of the approximation.
    expect(Math.abs(c.cctFromXY(c.daylightXY(9300)) - 9300)).toBeLessThan(100);
  });
});
