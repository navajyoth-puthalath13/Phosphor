import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('./screen-quality.ts', import.meta.url));
const fixture = (f: string) => fileURLToPath(new URL(`../../tests/fixtures/${f}`, import.meta.url));

// npm installs the bin as a symlink; run it the same way so "it printed nothing" can't regress.
const dir = mkdtempSync(join(tmpdir(), 'sq-'));
const bin = join(dir, 'screen-quality');
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
  it('fails loudly on a bad target', () => expect(() => run('simulate', 'x.png', '-t', 'nope', '-o', 'y.png')).toThrow(/unknown --target/));
});
