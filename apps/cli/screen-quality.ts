#!/usr/bin/env node
// screen-quality CLI. Commands: detect
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildSourceProfiles, type HelperReport } from '../../engines/display-detection/build-profile.ts';
import type { Sourced, SourceDisplayProfile } from '../../packages/profile-schema/index.ts';

const HELPER_BUILD = fileURLToPath(new URL('../../native/macos-helper/build/screen-quality-helper', import.meta.url));

function readHelperReport(from?: string): HelperReport {
  if (from) return JSON.parse(readFileSync(from, 'utf8'));
  if (process.platform !== 'darwin') throw new Error('display detection needs macOS (or pass --from <helper-report.json>)');
  const helper = process.env.SCREEN_QUALITY_HELPER ?? (existsSync(HELPER_BUILD) ? HELPER_BUILD : 'screen-quality-helper');
  try { return JSON.parse(execFileSync(helper, { encoding: 'utf8' })); }
  catch (e) { throw new Error(`could not run the native helper (${helper}). Build it with native/macos-helper/build.sh\n${(e as Error).message}`); }
}

const fmt = (v: Sourced<unknown>) => {
  if (v.value == null) return `unknown — ${v.note}`;
  const val = typeof v.value === 'object' ? JSON.stringify(v.value, (_, n) => (typeof n === 'number' ? +n.toFixed(4) : n)) : String(v.value);
  return `${val}${v.unit && !/^CIE|:1/.test(v.unit) ? ' ' + v.unit : ''}   [${v.source}, ${v.confidence} confidence]`;
};

export function formatReport(p: SourceDisplayProfile): string {
  const c = p.characteristics, id = p.identity, g = p.geometry;
  const lines = [
    `Display ${id.displayId}${id.main ? ' (main)' : ''}${id.builtIn ? ' (built-in)' : ''}: ${id.name.value ?? 'unnamed'}`,
    `  Manufacturer       ${fmt(id.manufacturerPnpId)}`,
    `  Product code       ${fmt(id.productCode)}`,
    `  Manufactured       ${fmt(id.manufactureYear)}`,
    `  Resolution         ${g.pixels.width}×${g.pixels.height} px (${g.points.width}×${g.points.height} pt)`,
    `  Physical size      ${fmt(g.physicalSizeMm)}`,
    `  Refresh rate       ${fmt(g.refreshRateHz)}`,
    `  Colour profile     ${p.colourProfile ? `${p.colourProfile.description ?? '(no description)'} — ICC ${p.colourProfile.iccVersion}` : 'none'}`,
    '  Characteristics',
    `    Luminance        ${fmt(c.luminance)}`,
    `    Contrast ratio   ${fmt(c.contrastRatio)}`,
    `    Gamut            ${fmt(c.gamut)}`,
    `    Tone response    ${fmt(c.toneResponse)}`,
    `    White point      ${fmt(c.whitePoint)}`,
    `    Framebuffer bpc  ${fmt(c.framebufferBitsPerComponent)}`,
    `    Interface bpc    ${fmt(c.interfaceBitsPerComponent)}`,
    `    Panel bpc        ${fmt(c.panelBitsPerComponent)}`,
    `    Chroma           ${fmt(c.chroma)}`,
    `    EDR headroom     ${fmt(c.edrHeadroom)}`,
    ...p.detection.warnings.map(w => `  ! ${w}`),
  ];
  return lines.join('\n');
}

function main(argv: string[]) {
  const [cmd, ...rest] = argv;
  if (cmd === 'detect') {
    const { values } = parseArgs({ args: rest, options: { json: { type: 'boolean' }, from: { type: 'string' } } });
    const profiles = buildSourceProfiles(readHelperReport(values.from));
    console.log(values.json ? JSON.stringify(profiles, null, 2) : profiles.map(formatReport).join('\n\n'));
    return;
  }
  console.log('usage: screen-quality detect [--json] [--from helper-report.json]');
  if (cmd && cmd !== 'help' && cmd !== '--help') process.exitCode = 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { main(process.argv.slice(2)); }
  catch (e) { console.error(`screen-quality: ${(e as Error).message}`); process.exitCode = 1; }
}
