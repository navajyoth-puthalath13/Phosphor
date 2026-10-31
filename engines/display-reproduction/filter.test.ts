import { describe, it, expect } from 'vitest';
import { compileFilter, evaluateFilter } from './filter.ts';
import { resolveParams, makeColourTransform, EFFECTS, type Effect } from './pipeline.ts';
import { TARGETS } from '../../packages/display-profiles/targets.ts';
import { type Vec3, linearSrgbToOklab, srgbDecode } from '../../packages/colour-math/index.ts';

const lattice: Vec3[] = [];
for (let r = 0; r <= 255; r += 15) for (let g = 0; g <= 255; g += 15) for (let b = 0; b <= 255; b += 15) lattice.push([r, g, b]);

const oklab = (c: number[]) => linearSrgbToOklab(c.map(v => srgbDecode(v / 255)) as Vec3);
/** Live filter vs CPU engine over colours the engine did not gamut-map: worst code-value gap and worst ΔE (OKLab). */
function worst(targetId: string, viewerNits: number | null, mode: 'absolute' | 'adapted', enabled?: Set<Effect>) {
  const t = TARGETS.find(x => x.id === targetId)!;
  const { p } = resolveParams(t, { whiteNits: viewerNits, mode }, enabled);
  const cpu = makeColourTransform(p), f = compileFilter(p);
  let max = 0, dE = 0, mapped = 0;
  for (const c of lattice) {
    const [ref, wasMapped] = cpu(...c);
    if (wasMapped) { mapped++; continue; }
    const got = evaluateFilter(f, c);
    const gap = Math.max(...got.map((v, i) => Math.abs(v - ref[i])));
    max = Math.max(max, gap);
    // One code value is the finest step 8-bit output can show; beyond that, judge by visible difference.
    if (gap > 1) { const a = oklab(ref), b = oklab(got); dE = Math.max(dE, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])); }
  }
  return { max, dE, mapped, managed: t.colourManaged };
}

describe('live filter = CPU engine (same model, compiled)', () => {
  for (const t of TARGETS) for (const mode of ['absolute', 'adapted'] as const) {
    it(`${t.id}, ${mode}`, () => {
      const { max, dE, mapped, managed } = worst(t.id, 400, mode);
      // What matters is visible difference: OKLab ΔE ≈ 0.02 is one just-noticeable step; stay under half of it.
      expect(dE, `${mapped} gamut-mapped colours excluded`).toBeLessThan(0.01);
      // Browsers store 8 bits between filter steps. Unmanaged targets also hold to ≤3 code values; the managed path
      // stores target-RGB in 8 bits, which near-black channels of saturated colours turn into larger (invisible) code gaps.
      if (!managed) expect(max).toBeLessThanOrEqual(3);
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

describe('monochrome panels', () => {
  const mono = { ...TARGETS.find(t => t.id === 'office-ips')!, monochrome: true };

  it('the CPU engine reduces colour to Rec. 601 luma, so pure blue goes dark and yellow stays light', () => {
    const cpu = makeColourTransform(resolveParams(mono, { whiteNits: null, mode: 'adapted' }, new Set<Effect>(['chroma'])).p);
    const [blue] = cpu(0, 0, 255), [yellow] = cpu(255, 255, 0);
    expect(blue[0]).toBe(blue[1]); expect(blue[1]).toBe(blue[2]);           // grey
    expect(blue[0]).toBeCloseTo(Math.round(0.114 * 255), -1);                // ≈ 29: dark
    expect(yellow[0]).toBeCloseTo(Math.round(0.886 * 255), -1);              // ≈ 226: light
  });

  it('live filter matches the CPU engine for monochrome', () => {
    const { p } = resolveParams(mono, { whiteNits: 400, mode: 'absolute' });
    const cpu = makeColourTransform(p), f = compileFilter(p);
    expect(f.steps.map(s => s.type)).toEqual(['luma', 'table', 'matrix']);
    let max = 0;
    for (const c of lattice) { const [ref, mapped] = cpu(...c); if (!mapped) max = Math.max(max, ...evaluateFilter(f, c).map((v, i) => Math.abs(v - ref[i]))); }
    expect(max).toBeLessThanOrEqual(3);
  });

  it('turning the chroma effect off also turns monochrome off', () => {
    expect(resolveParams(mono, { whiteNits: null, mode: 'adapted' }, new Set<Effect>(['gamma'])).p.monochrome).toBe(false);
  });

  it('says so when OS colour management stops live mode from applying chroma or monochrome', () => {
    const f = compileFilter(resolveParams({ ...mono, colourManaged: true }, { whiteNits: null, mode: 'adapted' }).p);
    expect(f.approximations.join()).toMatch(/monochrome is not applied live/);
  });
});
