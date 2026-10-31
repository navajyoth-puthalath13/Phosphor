import { describe, it, expect } from 'vitest';
import { validateTarget } from './validate.ts';
import { TARGETS, getTarget } from './targets.ts';

const roundTrip = (t: unknown) => JSON.parse(JSON.stringify(t));

describe('validateTarget', () => {
  it('accepts every built-in profile after a JSON round trip (Infinity contrast becomes null)', () => {
    for (const t of TARGETS) expect(() => validateTarget(roundTrip(t)), t.id).not.toThrow();
    expect(roundTrip(getTarget('srgb-reference')).contrastRatio.value).toBeNull();
  });

  it('accepts a user-edited custom profile', () => {
    const t = { ...roundTrip(getTarget('budget-tn')), id: 'ward-4b-monitor', name: 'Ward 4B monitor', technology: 'custom',
      luminance: { value: 160, source: 'measured', confidence: 'high', unit: 'cd/m²' } };
    expect(validateTarget(t).luminance.value).toBe(160);
  });

  it('lists every problem at once, in plain words', () => {
    const bad = { ...roundTrip(getTarget('budget-tn')), id: 'Bad ID!', luminance: { value: -5, source: 'measured' },
      primaries: { value: { red: { x: 0.6, y: 0.3 }, green: { x: 0.6, y: 0.3 }, blue: { x: 0.6, y: 0.3 } }, source: 'user' },
      bitDepth: { value: 7.5, source: 'user' }, toneResponse: { value: { type: 'gamma', gamma: 9 }, source: 'user' } };
    let msg = '';
    try { validateTarget(bad); } catch (e) { msg = (e as Error).message; }
    for (const k of ['id:', 'luminance.value', 'primaries.value', 'bitDepth.value', 'toneResponse.value']) expect(msg).toContain(k);
  });

  it('rejects non-objects and wrong kinds', () => {
    expect(() => validateTarget(null)).toThrow(/kind/);
    expect(() => validateTarget({ ...roundTrip(TARGETS[0]), kind: 'source' })).toThrow(/kind/);
  });
});
