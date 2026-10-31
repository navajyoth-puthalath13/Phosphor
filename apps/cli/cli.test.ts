import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('./phosphor.ts', import.meta.url));
const fixture = (f: string) => fileURLToPath(new URL(`../../tests/fixtures/${f}`, import.meta.url));

// npm installs the bin as a symlink; run it the same way so "it printed nothing" can't regress.
const dir = mkdtempSync(join(tmpdir(), 'phosphor-'));
const bin = join(dir, 'phosphor');
symlinkSync(cli, bin);
const run = (...args: string[]) => execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

describe('CLI through an npm-style symlink', () => {
  it('lists profiles', () => expect(run('profiles')).toMatch(/budget-tn/));
  it('detects from a recorded helper report', () => expect(run('detect', '--from', fixture('helper-report-builtin.json'))).toMatch(/Luminance\s+unknown/));
  it('simulates a screenshot', () => {
    const out = join(dir, 'out.png');
    run('simulate', fixture('clinical-ui.png'), '-t', 'budget-tn', '-o', out);
    expect(existsSync(out)).toBe(true);
  });
  it('converts a Display P3 screenshot to sRGB before simulating (macOS screenshot round trip)', () => {
    const out = join(dir, 'p3.png');
    const log = execFileSync(bin, ['simulate', fixture('clinical-ui-p3.png'), '-t', 'srgb-reference', '-o', out], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const a = PNG.sync.read(readFileSync(fixture('clinical-ui.png'))).data, b = PNG.sync.read(readFileSync(out)).data;
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
    expect(worst).toBeLessThanOrEqual(2); // two 8-bit roundings
    expect(log).toBe('');
  });

  it('exports a profile, and simulates with an edited copy via --target-file', () => {
    const t = JSON.parse(run('profiles', '--export', 'budget-tn'));
    Object.assign(t, { id: 'ward-4b', name: 'Ward 4B monitor', technology: 'custom' });
    t.luminance = { value: 150, source: 'measured', confidence: 'high', unit: 'cd/m²' };
    const file = join(dir, 'ward-4b.json'), out = join(dir, 'ward.png');
    writeFileSync(file, JSON.stringify(t));
    execFileSync(bin, ['simulate', fixture('clinical-ui.png'), '--target-file', file, '-o', out], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(existsSync(out)).toBe(true);
    t.bitDepth.value = 99; writeFileSync(file, JSON.stringify(t));
    expect(() => run('simulate', fixture('clinical-ui.png'), '--target-file', file, '-o', out)).toThrow(/bitDepth.value/);
  });

  it('fails loudly on a bad target', () => expect(() => run('simulate', 'x.png', '-t', 'nope', '-o', 'y.png')).toThrow(/unknown --target/));
});
