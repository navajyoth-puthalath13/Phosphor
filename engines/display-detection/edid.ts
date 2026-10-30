// EDID 1.3/1.4 base-block parser (VESA E-EDID Release A, Rev. 2).
// Everything here is what the manufacturer *wrote* into the monitor, not a measurement.

import type { XY, Primaries } from '../../packages/profile-schema/index.ts';

export interface Edid {
  manufacturerPnpId: string;
  manufacturerId: number;     // raw 16-bit, equals CGDisplayVendorNumber on macOS
  productCode: number;        // equals CGDisplayModelNumber
  serialNumber: number;
  manufactureYear: number | null;
  version: string;
  digital: boolean;
  interfaceBitsPerComponent: number | null; // EDID 1.4 digital only
  sizeCm: { width: number; height: number } | null;
  imageSizeMm: { width: number; height: number } | null; // from the preferred detailed timing
  gamma: number | null;
  primaries: Primaries;
  whitePoint: XY;
  name: string | null;
  serialString: string | null;
}

const HEADER = [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00];
const DEPTHS = [null, 6, 8, 10, 12, 14, 16, null];

export function parseEdid(b: Uint8Array): Edid {
  if (b.length < 128 || HEADER.some((v, i) => b[i] !== v)) throw new Error('not an EDID block');
  if (b.subarray(0, 128).reduce((s, v) => s + v, 0) % 256 !== 0) throw new Error('EDID checksum mismatch');

  const mid = (b[8] << 8) | b[9];
  const pnp = [10, 5, 0].map(s => String.fromCharCode(64 + ((mid >> s) & 31))).join('');
  const digital = (b[20] & 0x80) !== 0;
  const v14 = b[18] === 1 && b[19] >= 4;

  // Chromaticity: 10-bit values, high 8 bits in 27..34, low 2 bits packed into 25..26.
  const lo = (b[25] << 8) | b[26];
  const c = (hi: number, bit: number) => ((b[hi] << 2) | ((lo >> bit) & 3)) / 1024;
  const xy = (i: number): XY => ({ x: c(27 + 2 * i, 14 - 4 * i), y: c(28 + 2 * i, 12 - 4 * i) });

  let name: string | null = null, serialString: string | null = null, imageSizeMm = null;
  for (let o = 54; o < 126; o += 18) {
    if (b[o] | b[o + 1]) { // detailed timing descriptor (non-zero pixel clock)
      if (!imageSizeMm) {
        const w = b[o + 12] | ((b[o + 14] >> 4) << 8), h = b[o + 13] | ((b[o + 14] & 15) << 8);
        if (w && h) imageSizeMm = { width: w, height: h };
      }
      continue;
    }
    const text = () => new TextDecoder('latin1').decode(b.subarray(o + 5, o + 18)).split('\n')[0].trimEnd();
    if (b[o + 3] === 0xfc) name = text();
    if (b[o + 3] === 0xff) serialString = text();
  }

  return {
    manufacturerPnpId: pnp,
    manufacturerId: mid,
    productCode: b[10] | (b[11] << 8),
    serialNumber: (b[12] | (b[13] << 8) | (b[14] << 16) | (b[15] << 24)) >>> 0,
    manufactureYear: b[17] ? 1990 + b[17] : null,
    version: `${b[18]}.${b[19]}`,
    digital,
    interfaceBitsPerComponent: digital && v14 ? DEPTHS[(b[20] >> 4) & 7] : null,
    sizeCm: b[21] && b[22] ? { width: b[21], height: b[22] } : null,
    imageSizeMm,
    gamma: b[23] === 0xff ? null : (b[23] + 100) / 100,
    primaries: { red: xy(0), green: xy(1), blue: xy(2) },
    whitePoint: xy(3),
    name,
    serialString,
  };
}
