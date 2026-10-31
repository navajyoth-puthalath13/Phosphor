import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSetup, doctor, extensionId, stableBrewPath, browsers, HOST_NAME } from './setup.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const staticManifest = JSON.parse(readFileSync(here('../devtools-extension/static/manifest.json'), 'utf8'));

function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), 'phosphor-home-'));
  mkdirSync(join(home, '.config/google-chrome'), { recursive: true }); // pretend Chrome is installed
  return home;
}

describe('phosphor setup', () => {
  it('derives the extension ID Chrome will use from the committed manifest key', () => {
    expect(extensionId(staticManifest.key)).toBe('iajnbeakpaadcebcafohjioeceecbjjk');
  });

  it('maps Homebrew Cellar paths to stable opt/ paths when they exist', () => {
    const exists = (p: string) => p === '/opt/homebrew/opt/node/bin/node';
    expect(stableBrewPath('/opt/homebrew/Cellar/node/26.13.0_1/bin/node', exists)).toBe('/opt/homebrew/opt/node/bin/node');
    expect(stableBrewPath('/usr/local/bin/node', exists)).toBe('/usr/local/bin/node');
  });

  it('copies the extension, writes an executable host and registers it only for installed browsers', () => {
    const home = fakeHome();
    const r = runSetup({ home, platform: 'linux', cliPath: here('phosphor.ts'), nodePath: process.execPath, extensionSrc: here('../devtools-extension/static') });
    expect(r.registered).toEqual(['Google Chrome']);
    expect(existsSync(join(r.extensionDir, 'manifest.json'))).toBe(true);
    expect(statSync(r.wrapper).mode & 0o111).not.toBe(0);
    const m = JSON.parse(readFileSync(join(home, '.config/google-chrome/NativeMessagingHosts', `${HOST_NAME}.json`), 'utf8'));
    expect(m).toMatchObject({ name: HOST_NAME, type: 'stdio', path: r.wrapper, allowed_origins: ['chrome-extension://iajnbeakpaadcebcafohjioeceecbjjk/'] });
    expect(browsers(home, 'linux').map(b => b.name)).toEqual(['Google Chrome']); // Edge, Brave… not installed → untouched
    const d = doctor(home, 'linux');
    expect(d.ok).toBe(true);
    expect(d.lines.join('\n')).toMatch(/hasn't connected yet/);
  });

  it('doctor reports what is missing', () => {
    const d = doctor(fakeHome(), 'linux');
    expect(d.ok).toBe(false);
    expect(d.lines.join('\n')).toMatch(/run `phosphor setup`/);
  });
});

describe('native host (Chrome native messaging protocol)', () => {
  /** Sends framed messages to the host exactly as Chrome does and collects framed replies. */
  function talk(home: string, messages: unknown[]): Promise<any[]> {
    const fake = join(home, 'fake-helper');
    writeFileSync(fake, `#!/bin/sh\ncat ${JSON.stringify(here('../../tests/fixtures/helper-report-macbook-air.json'))}\n`);
    chmodSync(fake, 0o755);
    const child = spawn(process.execPath, [here('phosphor.ts'), 'native-host', 'chrome-extension://iajnbeakpaadcebcafohjioeceecbjjk/'],
      { env: { ...process.env, HOME: home, PHOSPHOR_HELPER: fake } });
    return new Promise((resolve, reject) => {
      let buf = Buffer.alloc(0); const replies: any[] = [];
      child.stdout.on('data', (c: Buffer) => {
        buf = Buffer.concat([buf, c]);
        while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32LE(0)) {
          replies.push(JSON.parse(buf.subarray(4, 4 + buf.readUInt32LE(0)).toString()));
          buf = buf.subarray(4 + buf.readUInt32LE(0));
          if (replies.length === messages.length) { child.kill(); resolve(replies); }
        }
      });
      child.on('error', reject);
      for (const m of messages) { const b = Buffer.from(JSON.stringify(m)); const h = Buffer.alloc(4); h.writeUInt32LE(b.length); child.stdin.write(Buffer.concat([h, b])); }
    });
  }

  it('answers ping and detect, and records that the extension connected', async () => {
    const home = fakeHome();
    const [ping, detect, bad] = await talk(home, [{ type: 'ping' }, { type: 'detect' }, { type: 'nope' }]);
    expect(ping).toMatchObject({ ok: true, version: '0.1.0' });
    expect(detect.profiles[0].identity.name.value).toBe('Built-in Retina Display');
    expect(detect.profiles[0].characteristics.whitePoint.value.x).toBeCloseTo(0.3127, 3);
    expect(bad.error).toMatch(/unknown request/);
    expect(JSON.parse(readFileSync(join(home, '.config/phosphor/last-connected.json'), 'utf8')).origin).toMatch(/^chrome-extension:/);
  });
});
