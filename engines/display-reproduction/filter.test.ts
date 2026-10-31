import { describe, it, expect } from 'vitest';
import { compileFilter, evaluateFilter } from './filter.ts';
import { resolveParams, makeColourTransform, EFFECTS, type Effect } from './pipeline.ts';
import { TARGETS } from '../../packages/display-profiles/targets.ts';
import type { Vec3 } from '../../packages/colour-math/index.ts';

const lattice: Vec3[] = [];
for (let r = 0; r <= 255; r += 15) for (let g = 0; g <= 255; g += 15) for (let b = 0; b <= 255; b += 15) lattice.push([r, g, b]);

/** Worst channel difference between live filter and CPU engine, over colours the engine did not gamut-map. */
function worst(targetId: string, viewerNits: number | null, mode: 'absolute' | 'adapted', enabled?: Set<Effect>) {
  const t = TARGETS.find(x => x.id === targetId)!;
  const { p } = resolveParams(t, { whiteNits: viewerNits, mode }, enabled);
  const cpu = makeColourTransform(p), f = compileFilter(p);
  let max = 0, mapped = 0;
  for (const c of lattice) {
    const [ref, wasMapped] = cpu(...c);
    if (wasMapped) { mapped++; continue; }
    const got = evaluateFilter(f, c);
    max = Math.max(max, ...got.map((v, i) => Math.abs(v - ref[i])));
  }
  return { max, mapped };
}

describe('live filter = CPU engine (same model, compiled)', () => {
  for (const t of TARGETS) for (const mode of ['absolute', 'adapted'] as const) {
    it(`${t.id}, ${mode}`, () => {
      const { max, mapped } = worst(t.id, 400, mode);
      // Browsers store 8 bits between filter steps; two stores can each round the same way at steep gamut edges.
      expect(max, `${mapped} gamut-mapped colours excluded`).toBeLessThanOrEqual(3);
    });
  }

  it('matches with any single effect enabled', () => {
    for (const e of EFFECTS) expect(worst('crt-9300k', 400, 'absolute', new Set([e])).max, e).toBeLessThanOrEqual(2);
  });

  it('the reference target compiles to an identity', () => {
    const { max } = worst('srgb-reference', 80, 'absolute');
    expect(max).toBe(0);
  });

  it('flags its approximations', () => {
    const t = { ...TARGETS[0], chroma: { value: 0.6, source: 'user' as const, confidence: 'high' as const } };
    const f = compileFilter(resolveParams(t, { whiteNits: null, mode: 'absolute' }).p);
    expect(f.approximations.join()).toMatch(/saturate/);
    expect(f.steps.map(s => s.type)).toEqual(['saturate', 'table', 'matrix']);
  });
});
