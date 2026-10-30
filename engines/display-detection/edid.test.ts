import { describe, it, expect } from 'vitest';
import { parseEdid } from './edid.ts';
import { makeEdid } from '../../tests/fixtures/make-edid.ts';

describe('parseEdid', () => {
  it('decodes identity, size, gamma and depth', () => {
    const e = parseEdid(makeEdid());
    expect(e.manufacturerPnpId).toBe('DEL');
    expect(e.manufacturerId).toBe(0x10ac);
    expect(e.productCode).toBe(0x1234);
    expect(e.serialNumber).toBe(0x12345678);
    expect(e.manufactureYear).toBe(2019);
    expect(e.version).toBe('1.4');
    expect(e.interfaceBitsPerComponent).toBe(8);
    expect(e.sizeCm).toEqual({ width: 53, height: 30 });
    expect(e.imageSizeMm).toEqual({ width: 527, height: 296 });
    expect(e.gamma).toBeCloseTo(2.2);
    expect(e.name).toBe('DELL P2419H');
  });

  it('decodes 10-bit chromaticities to within one code step', () => {
    const e = parseEdid(makeEdid());
    const step = 1 / 1024;
    expect(e.primaries.red.x).toBeCloseTo(0.64, 2); expect(Math.abs(e.primaries.red.y - 0.33)).toBeLessThan(step);
    expect(Math.abs(e.primaries.green.x - 0.30)).toBeLessThan(step); expect(Math.abs(e.primaries.green.y - 0.60)).toBeLessThan(step);
    expect(Math.abs(e.primaries.blue.x - 0.15)).toBeLessThan(step); expect(Math.abs(e.primaries.blue.y - 0.06)).toBeLessThan(step);
    expect(Math.abs(e.whitePoint.x - 0.3127)).toBeLessThan(step); expect(Math.abs(e.whitePoint.y - 0.3290)).toBeLessThan(step);
  });

  it('reports unknown rather than guessing', () => {
    const e = parseEdid(makeEdid({ depthCode: 0, gammaByte: 0xff }));
    expect(e.interfaceBitsPerComponent).toBeNull();
    expect(e.gamma).toBeNull();
  });

  it('rejects corrupt data', () => {
    const b = makeEdid(); b[40] ^= 1;
    expect(() => parseEdid(b)).toThrow(/checksum/);
    expect(() => parseEdid(new Uint8Array(128))).toThrow(/not an EDID/);
  });
});
