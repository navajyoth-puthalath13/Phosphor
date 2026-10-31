import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildSourceProfiles, pnpFromVendor, type HelperReport } from './build-profile.ts';
import { makeEdid } from '../../tests/fixtures/make-edid.ts';

const icc = readFileSync(new URL('../../tests/fixtures/lcms-srgb.icc', import.meta.url)).toString('base64');
const edid = Buffer.from(makeEdid()).toString('base64');

const report = (over: Partial<HelperReport['displays'][0]> = {}, edids = [edid]): HelperReport => ({
  helper: 'phosphor-macos-helper', helperVersion: '0.1.0', macOS: '15.1.0', edidsBase64: edids,
  displays: [{ id: 2, main: true, builtIn: false, vendor: 0x10ac, model: 0x1234, serial: 0x12345678,
    name: 'DELL P2419H', pixels: { width: 1920, height: 1080 }, points: { width: 1920, height: 1080 },
    refreshHz: 60, mm: { width: 527, height: 296 }, colourSpaceName: 'kCGColorSpaceDisplay',
    iccBase64: icc, bitsPerSample: 8, edrMaxPotential: 1, ...over }],
});

describe('buildSourceProfiles', () => {
  it('decodes PNP ids the way macOS reports them', () => {
    expect(pnpFromVendor(0x610)).toBe('APP');
    expect(pnpFromVendor(0x10ac)).toBe('DEL');
  });

  it('builds a profile with provenance on every characteristic', () => {
    const [p] = buildSourceProfiles(report(), new Date('2026-01-01T00:00:00Z'));
    expect(p.identity.manufacturerPnpId).toMatchObject({ value: 'DEL', source: 'os' });
    expect(p.identity.manufactureYear).toMatchObject({ value: 2019, source: 'edid' });
    expect(p.characteristics.gamut.source).toBe('icc');           // ICC wins over EDID
    expect(p.characteristics.whitePoint.value!.x).toBeCloseTo(0.3127, 3);
    expect(p.characteristics.interfaceBitsPerComponent).toMatchObject({ value: 8, source: 'edid' });
    expect(p.colourProfile?.iccVersion).toBe('4.4.0');
    expect(p.detection.warnings).toEqual([]);
    for (const [k, v] of Object.entries(p.characteristics)) expect(v.source, k).toBeDefined();
  });

  it('never invents luminance, contrast, panel depth or chroma', () => {
    const [p] = buildSourceProfiles(report());
    for (const k of ['luminance', 'contrastRatio', 'panelBitsPerComponent', 'chroma'] as const) {
      expect(p.characteristics[k].value, k).toBeNull();
      expect(p.characteristics[k].source).toBe('unknown');
      expect(p.characteristics[k].note).toBeTruthy();
    }
  });

  it('falls back to EDID when there is no ICC, and to unknown when there is neither', () => {
    const [withEdid] = buildSourceProfiles(report({ iccBase64: undefined }));
    expect(withEdid.characteristics.gamut.source).toBe('edid');
    expect(withEdid.characteristics.toneResponse.value).toEqual({ type: 'gamma', gamma: 2.2 });

    const [bare] = buildSourceProfiles(report({ iccBase64: undefined, builtIn: true }, []));
    expect(bare.characteristics.gamut.source).toBe('unknown');
    expect(bare.detection.warnings).toContain('no EDID exposed (normal for built-in Apple panels)');
  });

  it('refuses to guess between identical monitors', () => {
    const twin = Buffer.from(makeEdid()).toString('base64');
    const [p] = buildSourceProfiles(report({ serial: 0 }, [edid, twin, edid]));
    // two EDIDs with the same vendor/model and no serial to tell them apart
    expect(p.identity.manufactureYear.source).toBe('unknown');
    expect(p.detection.warnings[0]).toMatch(/several identical monitors/);
  });

  it('keeps going when one EDID is corrupt', () => {
    const bad = Buffer.from(new Uint8Array(128)).toString('base64');
    const [p] = buildSourceProfiles(report({}, [bad, edid]));
    expect(p.identity.manufactureYear.value).toBe(2019);
    expect(p.detection.warnings[0]).toMatch(/ignored unreadable EDID/);
  });
});

describe('real hardware: MacBook Air built-in panel (macOS 27, ICC v2 "Display")', () => {
  const report = JSON.parse(readFileSync(new URL('../../tests/fixtures/helper-report-macbook-air.json', import.meta.url), 'utf8'));
  const [p] = buildSourceProfiles(report);

  it('reads Display P3 primaries and a D65 white from the Apple v2 profile', () => {
    const g = p.characteristics.gamut.value!;
    expect(g.red.x).toBeCloseTo(0.68, 2); expect(g.green.y).toBeCloseTo(0.69, 2); expect(g.blue.y).toBeCloseTo(0.06, 2);
    expect(p.characteristics.whitePoint.value!.x).toBeCloseTo(0.3127, 3);
    expect(p.characteristics.whitePoint.value!.y).toBeCloseTo(0.3290, 3);
    expect(p.characteristics.toneResponse.value).toMatchObject({ type: 'table', points: 1024 });
    expect(p.colourProfile).toMatchObject({ description: 'Display', iccVersion: '2.1.0' });
  });

  it('identifies the panel and reports the expected unknowns', () => {
    expect(p.identity.manufacturerPnpId.value).toBe('APP');
    expect(p.geometry.pixels).toEqual({ width: 3420, height: 2224 });
    expect(p.characteristics.edrHeadroom.value).toBe(2);
    expect(p.characteristics.luminance.source).toBe('unknown');
  });
});
