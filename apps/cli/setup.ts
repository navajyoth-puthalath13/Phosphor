// `phosphor setup` / `phosphor doctor` / `phosphor native-host`: connects Chromium browsers to the native helper.
// Browsers never let a program install an extension silently; setup registers the connection and guides the
// one-click install. Everything here takes `home`/`platform` so it is testable without touching the real profile.

import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const HOST_NAME = 'com.phosphor.helper';
/** Chrome Web Store listing, once published. While null, setup guides a "Load unpacked" install. */
export const STORE_URL: string | null = null;

export const stateDir = (home: string, platform = process.platform) =>
  platform === 'darwin' ? join(home, 'Library/Application Support/Phosphor') : join(home, '.config/phosphor');

/** Chromium browsers and where each looks for native messaging hosts (user level). */
export function browsers(home: string, platform = process.platform): { name: string; dir: string; hostDir: string }[] {
  const mac = (name: string, rel: string, sub = '') => ({ name, dir: join(home, 'Library/Application Support', rel), hostDir: join(home, 'Library/Application Support', rel, sub, 'NativeMessagingHosts') });
  const lin = (name: string, rel: string) => ({ name, dir: join(home, '.config', rel), hostDir: join(home, '.config', rel, 'NativeMessagingHosts') });
  const all = platform === 'darwin'
    ? [mac('Google Chrome', 'Google/Chrome'), mac('Chrome Beta', 'Google/Chrome Beta'), mac('Chrome Canary', 'Google/Chrome Canary'),
      mac('Chromium', 'Chromium'), mac('Microsoft Edge', 'Microsoft Edge'), mac('Brave', 'BraveSoftware/Brave-Browser'), mac('Arc', 'Arc', 'User Data')]
    : [lin('Google Chrome', 'google-chrome'), lin('Chromium', 'chromium'), lin('Microsoft Edge', 'microsoft-edge'), lin('Brave', 'BraveSoftware/Brave-Browser')];
  return all.filter(b => existsSync(b.dir));
}

/** Chrome's extension ID for a manifest "key": first 32 hex digits of SHA-256(public key), mapped 0-f → a-p. */
export const extensionId = (keyBase64: string) =>
  [...createHash('sha256').update(Buffer.from(keyBase64, 'base64')).digest('hex').slice(0, 32)].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');

/** Homebrew Cellar paths change on every upgrade; its opt/ symlinks don't. */
export function stableBrewPath(p: string, exists: (path: string) => boolean = existsSync) {
  const m = p.match(/^(.*)\/Cellar\/([^/]+)\/[^/]+\/(.*)$/);
  const opt = m && `${m[1]}/opt/${m[2]}/${m[3]}`;
  return opt && exists(opt) ? opt : p;
}

export interface SetupResult { extensionDir: string; extensionId: string; wrapper: string; registered: string[] }

export function runSetup(o: { home: string; platform?: NodeJS.Platform; cliPath: string; nodePath: string; extensionSrc: string }): SetupResult {
  const dir = stateDir(o.home, o.platform);
  if (!existsSync(join(o.extensionSrc, 'manifest.json'))) throw new Error(`extension build not found at ${o.extensionSrc}; run \`npm run build\``);
  mkdirSync(dir, { recursive: true });

  // A stable copy: Chrome keeps loading an unpacked extension from the folder you picked, across upgrades.
  const extensionDir = join(dir, 'chrome-extension');
  rmSync(extensionDir, { recursive: true, force: true });
  cpSync(o.extensionSrc, extensionDir, { recursive: true });
  const id = extensionId(JSON.parse(readFileSync(join(extensionDir, 'manifest.json'), 'utf8')).key);

  // Browsers start the host without arguments of our choosing and with a minimal PATH, so pin absolute paths.
  const wrapper = join(dir, 'phosphor-native-host');
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  writeFileSync(wrapper, `#!/bin/sh\nexec ${q(stableBrewPath(o.nodePath))} ${q(stableBrewPath(realpathSync(o.cliPath)))} native-host "$@"\n`);
  chmodSync(wrapper, 0o755);

  const manifest = { name: HOST_NAME, description: 'Phosphor display helper', path: wrapper, type: 'stdio', allowed_origins: [`chrome-extension://${id}/`] };
  const registered: string[] = [];
  for (const b of browsers(o.home, o.platform)) {
    mkdirSync(b.hostDir, { recursive: true });
    writeFileSync(join(b.hostDir, `${HOST_NAME}.json`), JSON.stringify(manifest, null, 2));
    registered.push(b.name);
  }
  return { extensionDir, extensionId: id, wrapper, registered };
}

export function doctor(home: string, platform = process.platform): { ok: boolean; lines: string[] } {
  const dir = stateDir(home, platform), lines: string[] = [];
  let ok = true;
  const check = (pass: boolean, good: string, bad: string) => { lines.push(`${pass ? '✓' : '✗'} ${pass ? good : bad}`); ok &&= pass; };
  const ext = join(dir, 'chrome-extension');
  check(existsSync(join(ext, 'manifest.json')), `extension folder ready: ${ext}`, 'extension folder missing — run `phosphor setup`');
  const wrapper = join(dir, 'phosphor-native-host');
  check(existsSync(wrapper) && (statSync(wrapper).mode & 0o111) !== 0, 'native host installed', 'native host missing — run `phosphor setup`');
  const found = browsers(home, platform);
  if (!found.length) check(false, '', 'no Chromium browser found (Chrome, Edge, Brave, Arc, Chromium)');
  for (const b of found) {
    const m = join(b.hostDir, `${HOST_NAME}.json`);
    check(existsSync(m) && JSON.parse(readFileSync(m, 'utf8')).path === wrapper, `${b.name}: connection registered`, `${b.name}: not registered — run \`phosphor setup\``);
  }
  const seen = join(dir, 'last-connected.json');
  if (existsSync(seen)) lines.push(`✓ extension last talked to the helper at ${JSON.parse(readFileSync(seen, 'utf8')).time}`);
  else lines.push('• extension hasn\'t connected yet — open DevTools on any page and click the Phosphor tab');
  return { ok, lines };
}

/** Chrome native messaging: each message is a 32-bit native-endian (little-endian on Mac/Linux) length + UTF-8 JSON. */
export function serveNativeMessages(input: NodeJS.ReadableStream, output: NodeJS.WritableStream, handle: (msg: any) => unknown) {
  let buf = Buffer.alloc(0);
  const send = (obj: unknown) => {
    const body = Buffer.from(JSON.stringify(obj));
    const head = Buffer.alloc(4); head.writeUInt32LE(body.length);
    output.write(Buffer.concat([head, body]));
  };
  input.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32LE(0)) {
      const n = buf.readUInt32LE(0);
      let reply: unknown;
      try { reply = handle(JSON.parse(buf.subarray(4, 4 + n).toString('utf8'))); }
      catch (e) { reply = { error: (e as Error).message }; }
      buf = buf.subarray(4 + n);
      send(reply);
    }
  });
}

export const GUIDE = `
Phosphor DevTools panel — controls
  Open any page → right-click → Inspect → "Phosphor" tab (in the » menu if hidden).

  Your display      what the helper detected; enter your screen's brightness (cd/m²) to simulate dimmer displays
  Target display    pick a generic display or one of your saved profiles
  Reproduction      the seven characteristics; untick one to remove that limitation
    Luminance       peak white of the target, cd/m²
    Contrast ratio  white : black; low contrast lifts blacks and merges dark UI
    Colour gamut    sRGB, Display P3, Adobe RGB, Rec. 2020, budget ~45% NTSC, CRT/CCFL, or custom primaries
    Gamma           tone curve: power law 1.8–2.8 or the sRGB curve
    White point     colour temperature of white, 5000–10000 K
    Colour depth    6/8/10-bit panel, with or without FRC dithering
    Chroma          picture-mode saturation
    Reset · Save as my profile · Export / Import JSON
  Simulation
    Live on page        the page itself changes; layout and clicks keep working
    Hold to compare     shows the original while held
    Capture preview     exact still with a draggable original/simulated split
`;
