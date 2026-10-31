import { describe, it, expect } from 'vitest';
import { contentToSrgb, isSrgbLike } from './content.ts';
import { readFileSync } from 'node:fs';
import { parseIcc } from '../../packages/icc/index.ts';
import { DISPLAY_P3, SRGB, D65, srgbDecode } from '../../packages/colour-math/index.ts';

const p3 = { primaries: DISPLAY_P3, white: D65, curves: [srgbDecode, srgbDecode, srgbDecode] as [typeof srgbDecode, typeof srgbDecode, typeof srgbDecode] };

describe('contentToSrgb (macOS screenshots are Display P3)', () => {
  it('maps the CSS Color 4 Display P3 encoding of sRGB red back to sRGB red', () => {
    const p3red = [0.9175, 0.2003, 0.1386].map(v => Math.round(v * 255));
    const { data } = contentToSrgb(new Uint8ClampedArray([...p3red, 255]), p3);
    expect(data[0]).toBeGreaterThanOrEqual(254); expect(data[1]).toBeLessThanOrEqual(3); expect(data[2]).toBeLessThanOrEqual(3);
  });

  it('keeps neutrals neutral and alpha untouched', () => {
    const { data } = contentToSrgb(new Uint8ClampedArray([255, 255, 255, 7, 128, 128, 128, 255]), p3);
    expect(Array.from(data)).toEqual([255, 255, 255, 7, 128, 128, 128, 255]);
  });

  it('gamut-maps real P3 colours that sRGB cannot show, and counts them', () => {
    const { outOfGamutPixels } = contentToSrgb(new Uint8ClampedArray([0, 255, 0, 255]), p3);
    expect(outOfGamutPixels).toBe(1);
  });

  it('recognises sRGB-tagged content as a no-op', () => {
    expect(isSrgbLike({ ...p3, primaries: SRGB })).toBe(true);
    expect(isSrgbLike(p3)).toBe(false);
  });
});

describe('with a real Apple profile (MacBook Air "Display", ICC v2)', () => {
  const report = JSON.parse(readFileSync(new URL('../../tests/fixtures/helper-report-macbook-air.json', import.meta.url), 'utf8'));
  it("converts this profile's screenshots correctly (P3-encoded red → sRGB red)", () => {
    const icc = parseIcc(Buffer.from(report.displays[0].iccBase64, 'base64'));
    const p3red = [0.9175, 0.2003, 0.1386].map(v => Math.round(v * 255));
    const { data } = contentToSrgb(new Uint8ClampedArray([...p3red, 255]), { primaries: icc.primaries!, white: icc.whitePoint!, curves: icc.curves! });
    expect(data[0]).toBeGreaterThanOrEqual(253); expect(data[1]).toBeLessThanOrEqual(4); expect(data[2]).toBeLessThanOrEqual(4);
  });
});
