import { describe, it, expect } from 'vitest';
import { TARGETS } from './targets.ts';
import { gamutArea, cctFromXY, NTSC1953 } from '../colour-math/index.ts';

describe('target profiles', () => {
  it('have unique ids and documented provenance for every characteristic', () => {
    expect(new Set(TARGETS.map(t => t.id)).size).toBe(TARGETS.length);
    for (const t of TARGETS) {
      expect(t.assumptions.length, t.id).toBeGreaterThan(0);
      for (const k of ['luminance', 'contrastRatio', 'primaries', 'whitePoint', 'toneResponse', 'bitDepth', 'chroma'] as const) {
        expect(t[k].value, `${t.id}.${k}`).not.toBeNull();
        expect(['standard', 'estimated', 'manufacturer-spec', 'measured', 'user']).toContain(t[k].source);
        expect(t[k].note, `${t.id}.${k} needs a reason`).toBeTruthy();
      }
    }
  });

  it('budget TN primaries really are a "45% NTSC" gamut', () => {
    const t = TARGETS.find(t => t.id === 'budget-tn')!;
    expect(gamutArea(t.primaries.value!) / gamutArea(NTSC1953)).toBeCloseTo(0.45, 1);
  });

  it('CRT white is near 9300 K', () => {
    const t = TARGETS.find(t => t.id === 'crt-9300k')!;
    expect(Math.abs(cctFromXY(t.whitePoint.value!) - 9300)).toBeLessThan(150);
  });
});
