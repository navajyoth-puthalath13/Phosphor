// Regenerates clinical-ui-p3.png: clinical-ui.png re-encoded as Display P3 and tagged with a P3 ICC profile,
// like a macOS screenshot. The P3 profile is the littleCMS sRGB profile with P3 colorants written in.
// Run: node tests/fixtures/make-p3-screenshot.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { PNG } from 'pngjs';
import { DISPLAY_P3, D65, D50_ICC, rgbToXyz, bradford, mul, xyToXYZ } from '../../packages/colour-math/index.ts';
import { osColourManagement } from '../../engines/display-reproduction/stages.ts';

const here = (f: string) => new URL(f, import.meta.url);
const icc = Buffer.from(readFileSync(here('lcms-srgb.icc')));
const toD50 = bradford(xyToXYZ(D65), D50_ICC);
const m = rgbToXyz(DISPLAY_P3, D65);
const n = icc.readUInt32BE(128);
for (let i = 0; i < n; i++) {
  const t = 132 + 12 * i, sig = icc.toString('latin1', t, t + 4), off = icc.readUInt32BE(t + 4);
  const col = { rXYZ: 0, gXYZ: 1, bXYZ: 2 }[sig];
  if (col === undefined) continue;
  mul(toD50, [m[0][col], m[1][col], m[2][col]]).forEach((v, k) => icc.writeInt32BE(Math.round(v * 65536), off + 8 + 4 * k));
}

// Rename the description (same length, UTF-16BE inside 'mluc') so messages don't say "sRGB".
const at = icc.indexOf(Buffer.from('sRGB built-in', 'utf16le').swap16());
Buffer.from('Test P3 (fix)', 'utf16le').swap16().copy(icc, at);

const src = PNG.sync.read(readFileSync(here('clinical-ui.png')));
for (let i = 0; i < src.data.length; i += 4) {
  const p3 = osColourManagement([src.data[i] / 255, src.data[i + 1] / 255, src.data[i + 2] / 255], DISPLAY_P3, D65, { type: 'srgb' });
  p3.forEach((v, k) => (src.data[i + k] = Math.round(v * 255)));
}
const png = PNG.sync.write(src);
const body = Buffer.concat([Buffer.from('Display P3\0\0'), deflateSync(icc)]);
const typed = Buffer.concat([Buffer.from('iCCP'), body]);
const chunk = Buffer.alloc(12 + body.length);
chunk.writeUInt32BE(body.length, 0); typed.copy(chunk, 4); chunk.writeUInt32BE(crc32(typed), 8 + body.length);
writeFileSync(here('clinical-ui-p3.png'), Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]));
