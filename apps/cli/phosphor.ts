#!/usr/bin/env node
// phosphor CLI. Commands: detect, profiles, simulate
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildSourceProfiles, type HelperReport } from '../../engines/display-detection/build-profile.ts';
import type { Sourced, SourceDisplayProfile } from '../../packages/profile-schema/index.ts';
import { simulate, EFFECTS, type Effect } from '../../engines/display-reproduction/pipeline.ts';
import { TARGETS, getTarget } from '../../packages/display-profiles/targets.ts';
import { validateTarget } from '../../packages/display-profiles/validate.ts';
import { PNG } from 'pngjs';
import { parseIcc, iccFromPng } from '../../packages/icc/index.ts';
import { contentToSrgb, isSrgbLike } from '../../engines/display-reproduction/content.ts';

// Package root is two levels up from source (apps/cli) and three from the compiled dist/apps/cli.
const ROOT = ['../../', '../../../'].map(p => new URL(p, import.meta.url)).find(u => existsSync(new URL('package.json', u)))!;
const HELPER_BUILD = fileURLToPath(new URL('native/macos-helper/build/phosphor-helper', ROOT));

function readHelperReport(from?: string): HelperReport {
  if (from) return JSON.parse(readFileSync(from, 'utf8'));
  if (process.platform !== 'darwin') throw new Error('display detection needs macOS (or pass --from <helper-report.json>)');
  const helper = process.env.PHOSPHOR_HELPER ?? (existsSync(HELPER_BUILD) ? HELPER_BUILD : 'phosphor-helper');
  try { return JSON.parse(execFileSync(helper, { encoding: 'utf8' })); }
  catch (e) { throw new Error(`could not run the native helper (${helper}). Build it with native/macos-helper/build.sh\n${(e as Error).message}`); }
}

const fmt = (v: Sourced<unknown>) => {
  if (v.value == null) return `unknown — ${v.note}`;
  const val = typeof v.value === 'object' ? JSON.stringify(v.value, (_, n) => (typeof n === 'number' ? +n.toFixed(4) : n)) : String(v.value);
  return `${val}${v.unit && !/^CIE|:1/.test(v.unit) ? ' ' + v.unit : ''}   [${v.source}, ${v.confidence} confidence]`;
};

function formatReport(p: SourceDisplayProfile): string {
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

/** Screenshots carry their colour space (macOS: the display's own, usually Display P3); the engine expects sRGB. */
function toSrgbContent(bytes: Uint8Array, pixels: Uint8Array) {
  const raw = iccFromPng(bytes);
  if (!raw) return pixels;
  try {
    const icc = parseIcc(raw);
    if (!icc.primaries || !icc.whitePoint || !icc.curves) {
      console.error(`note: embedded profile "${icc.description}" is not matrix/TRC; pixels interpreted as sRGB`);
      return pixels;
    }
    const space = { primaries: icc.primaries, white: icc.whitePoint, curves: icc.curves };
    if (isSrgbLike(space)) return pixels;
    const c = contentToSrgb(pixels, space);
    console.error(`input: converted from embedded profile "${icc.description}" to sRGB${c.outOfGamutPixels ? ` (${c.outOfGamutPixels} px outside sRGB, gamut-mapped)` : ''}`);
    return c.data;
  } catch (e) {
    console.error(`note: embedded ICC profile unreadable (${(e as Error).message}); pixels interpreted as sRGB`);
    return pixels;
  }
}

function main(argv: string[]) {
  const [cmd, ...rest] = argv;
  if (cmd === 'detect') {
    const { values } = parseArgs({ args: rest, options: { json: { type: 'boolean' }, from: { type: 'string' } } });
    const profiles = buildSourceProfiles(readHelperReport(values.from));
    console.log(values.json ? JSON.stringify(profiles, null, 2) : profiles.map(formatReport).join('\n\n'));
    return;
  }
  if (cmd === 'profiles') {
    const { values } = parseArgs({ args: rest, options: { export: { type: 'string' } } });
    if (values.export) {
      const t = getTarget(values.export);
      if (!t) throw new Error(`unknown profile ${values.export}. Choose one of: ${TARGETS.map(x => x.id).join(', ')}`);
      console.log(JSON.stringify(t, null, 2)); // Infinity contrast becomes null, which the engine reads as ideal black
      return;
    }
    for (const t of TARGETS) console.log(`${t.id.padEnd(22)} ${t.name}`);
    return;
  }
  if (cmd === 'simulate') {
    const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: {
      target: { type: 'string', short: 't' }, 'target-file': { type: 'string' }, out: { type: 'string', short: 'o' },
      'viewer-nits': { type: 'string' }, mode: { type: 'string', default: 'absolute' },
      only: { type: 'string' }, disable: { type: 'string' },
    } });
    const target = values['target-file'] ? validateTarget(JSON.parse(readFileSync(values['target-file'], 'utf8'))) : getTarget(values.target ?? '');
    if (!target) throw new Error(`unknown --target. Choose one of: ${TARGETS.map(t => t.id).join(', ')} (or --target-file my-display.json)`);
    if (positionals.length !== 1 || !values.out) throw new Error('usage: phosphor simulate <in.png> -t <target> -o <out.png>');
    if (values.mode !== 'absolute' && values.mode !== 'adapted') throw new Error('--mode must be absolute or adapted');
    const list = (v?: string) => (v ? v.split(',').map(e => { if (!EFFECTS.includes(e as Effect)) throw new Error(`unknown effect ${e}; effects: ${EFFECTS.join(', ')}`); return e as Effect; }) : []);
    const enabled = new Set<Effect>(values.only ? list(values.only) : EFFECTS.filter(e => !list(values.disable).includes(e)));
    const nits = values['viewer-nits'] == null ? null : Number(values['viewer-nits']);
    if (nits != null && !(nits > 0)) throw new Error('--viewer-nits must be a positive number');

    const bytes = readFileSync(positionals[0]);
    const png = PNG.sync.read(bytes);
    const r = simulate(toSrgbContent(bytes, png.data), target, { whiteNits: nits, mode: values.mode }, enabled);
    png.data = Buffer.from(r.data.buffer);
    writeFileSync(values.out, PNG.sync.write(png));
    r.warnings.forEach(w => console.error(`warning: ${w}`));
    console.error(`${target.name}: ${[...enabled].join(', ')} → ${values.out}${r.outOfGamutPixels ? ` (${r.outOfGamutPixels} px gamut-mapped)` : ''}`);
    return;
  }
  console.log([
    'usage:',
    '  phosphor detect [--json] [--from helper-report.json]',
    '  phosphor profiles [--export <id>]       export a profile as JSON to edit into your own',
    '  phosphor simulate <in.png> (-t <target> | --target-file my.json) -o <out.png> [--viewer-nits N] [--mode absolute|adapted]',
    `                          [--only e1,e2 | --disable e1,e2]   effects: ${EFFECTS.join(', ')}`,
  ].join('\n'));
  if (cmd && cmd !== 'help' && cmd !== '--help') process.exitCode = 2;
}

try { main(process.argv.slice(2)); }
catch (e) { console.error(`phosphor: ${(e as Error).message}`); process.exitCode = 1; }
