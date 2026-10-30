// Test-only EDID builder.
/** Builds a 128-byte EDID 1.4 block. Encoding written straight from the VESA layout tables. */
export function makeEdid(o: { name?: string; year?: number; depthCode?: number; gammaByte?: number } = {}) {
  const b = new Uint8Array(128);
  b.set([0, 255, 255, 255, 255, 255, 255, 0]);
  b.set([0x10, 0xac], 8);                 // "DEL" — Dell's well-known PNP vendor id 0x10AC
  b.set([0x34, 0x12], 10);                // product 0x1234
  b.set([0x78, 0x56, 0x34, 0x12], 12);    // serial 0x12345678
  b[17] = (o.year ?? 2019) - 1990;
  b[18] = 1; b[19] = 4;
  b[20] = 0x80 | ((o.depthCode ?? 2) << 4); // digital, 8 bpc
  b[21] = 53; b[22] = 30;
  b[23] = o.gammaByte ?? 120;              // gamma 2.20
  // sRGB primaries as 10-bit codes: round(v*1024)
  const codes = [0.64, 0.33, 0.30, 0.60, 0.15, 0.06, 0.3127, 0.3290].map(v => Math.round(v * 1024));
  b[25] = ((codes[0] & 3) << 6) | ((codes[1] & 3) << 4) | ((codes[2] & 3) << 2) | (codes[3] & 3);
  b[26] = ((codes[4] & 3) << 6) | ((codes[5] & 3) << 4) | ((codes[6] & 3) << 2) | (codes[7] & 3);
  codes.forEach((c, i) => (b[27 + i] = c >> 2));
  // descriptor 1: detailed timing with 527 x 296 mm image size
  b[54] = 0x02; b[55] = 0x3a; b[66] = 527 & 255; b[67] = 296 & 255; b[68] = ((527 >> 8) << 4) | (296 >> 8);
  // descriptor 2: monitor name
  b.set([0, 0, 0, 0xfc, 0], 72);
  const name = new TextEncoder().encode(((o.name ?? 'DELL P2419H') + '\n').padEnd(13, ' '));
  b.set(name, 77);
  b[127] = (256 - (b.subarray(0, 127).reduce((s, v) => s + v, 0) % 256)) % 256;
  return b;
}
