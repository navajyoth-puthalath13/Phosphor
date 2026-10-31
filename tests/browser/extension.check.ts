// End-to-end check of the built extension in Chromium: native messaging via `phosphor setup`'s real output,
// the panel's controls, live mode on a page, capture, saving a profile, and cleanup when DevTools closes.
// Headless Chromium can't open DevTools itself, so chrome.devtools is stubbed with the real APIs underneath.
// Run after `npm run build`: node tests/browser/extension.check.ts [screenshot-dir]
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSetup } from '../../apps/cli/setup.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const shots = process.argv[2];
const { chromium } = createRequire(import.meta.url)('playwright');
const assert = (ok: unknown, what: string) => { if (!ok) { console.error(`✗ ${what}`); process.exit(1); } console.log(`✓ ${what}`); };

// A web page to inspect.
const html = readFileSync(here('../fixtures/clinical-ui.html'));
const server = createServer((_q, r) => { r.setHeader('content-type', 'text/html'); r.end(html); }).listen(0);
const pageUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;

// `phosphor setup` into a throwaway home whose Chromium profile is the one we launch.
const home = mkdtempSync(join(tmpdir(), 'phosphor-e2e-'));
const profile = join(home, '.config/chromium');
mkdirSync(profile, { recursive: true });
const fake = join(home, 'fake-helper');
writeFileSync(fake, `#!/bin/sh\ncat ${JSON.stringify(here('../fixtures/helper-report-macbook-air.json'))}\n`); chmodSync(fake, 0o755);
const setup = runSetup({ home, platform: 'linux', cliPath: here('../../apps/cli/phosphor.ts'), nodePath: process.execPath, extensionSrc: here('../../dist/extension') });

const ctx = await chromium.launchPersistentContext(profile, {
  headless: true, channel: 'chromium', viewport: { width: 1100, height: 900 }, // full Chromium: the headless shell has no extensions
  args: [`--disable-extensions-except=${setup.extensionDir}`, `--load-extension=${setup.extensionDir}`],
  env: { ...process.env, HOME: home, PHOSPHOR_HELPER: fake },
});
const sw = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
assert(id === setup.extensionId, `extension loaded with the fixed ID ${id}`);

// The inspected page lives in its own window so captureVisibleTab sees it as the active tab.
const tabId: number = await sw.evaluate(async (url: string) => (await chrome.windows.create({ url, focused: false }))?.tabs?.[0]?.id ?? -1, pageUrl);
await new Promise(r => setTimeout(r, 800));
const target = ctx.pages().find((p: any) => p.url() === pageUrl);
await target.evaluate(() => { document.documentElement.style.setProperty('min-height', '50px'); }); // page's own inline style must survive

const panel = await ctx.newPage();
await panel.addInitScript((tab: number) => {
  (chrome as any).devtools = {
    inspectedWindow: {
      tabId: tab,
      eval(code: string, cb?: (r: unknown, e?: unknown) => void) {
        chrome.scripting.executeScript({ target: { tabId: tab }, world: 'MAIN', func: (c: string) => (0, eval)(c), args: [code] })
          .then(() => cb?.(undefined, undefined), (e: Error) => cb?.(undefined, { isException: true, value: e.message }));
      },
    },
    panels: { themeName: 'default' },
    network: { onNavigated: { addListener() {} } },
  };
}, tabId);
const errors: string[] = [];
panel.on('pageerror', (e: Error) => errors.push(e.message));
await panel.goto(`chrome-extension://${id}/panel.html`);

await panel.waitForFunction(() => /Detected/.test(document.getElementById('source-status')!.textContent!), null, { timeout: 15000 });
assert(true, 'panel shows the display detected through native messaging');
assert((await panel.textContent('#source-facts'))!.includes('Built-in Retina Display'), 'source display facts rendered');

await new Promise(r => setTimeout(r, 400));
const matrix = () => target.evaluate(() => document.querySelector('#phosphor-live feColorMatrix')?.getAttribute('values') ?? null);
assert(await panel.isChecked('#live') && (await matrix()) !== null, 'live mode is on as soon as the panel opens');
const before = await matrix();
await panel.selectOption('#target', 'crt-9300k');
await new Promise(r => setTimeout(r, 300));
assert((await matrix()) !== before, 'switching the target display changes the page immediately');
await panel.selectOption('#target', 'budget-tn');
await panel.fill('#viewer-nits', '400'); await panel.dispatchEvent('#viewer-nits', 'change');
await new Promise(r => setTimeout(r, 400));
const filter = await target.evaluate(() => document.documentElement.style.getPropertyValue('filter'));
assert(/url\("?#phosphor-live-filter"?\)/.test(filter), 'live mode applies the filter to the inspected page');
if (shots) await target.screenshot({ path: join(shots, 'live-budget-tn.png') });

// Real sites: a theme switcher rewriting <html style>, and modal dialogs in the top layer.
await target.evaluate(() => document.documentElement.setAttribute('style', 'color-scheme: light'));
await new Promise(r => setTimeout(r, 200));
assert(/phosphor-live-filter/.test(await target.evaluate(() => document.documentElement.style.getPropertyValue('filter'))), 'survives a page rewriting <html style>');
const dialogFilter = await target.evaluate(() => {
  const d = document.createElement('dialog'); d.textContent = 'modal'; document.body.append(d); d.showModal();
  const f = getComputedStyle(d).filter; d.close(); d.remove(); return f;
});
assert(/phosphor-live-filter/.test(dialogFilter), 'modal dialogs (top layer) are simulated too');

await panel.fill('#contrast', '2'); await panel.dispatchEvent('#contrast', 'input'); // 100:1
assert(await panel.inputValue('#contrast-num') === '100', 'contrast slider updates its number field');
await panel.fill('#luminance-num', '150'); await panel.dispatchEvent('#luminance-num', 'change');
assert(await panel.inputValue('#luminance') === '150', 'typing a number moves the slider');
await panel.click('[data-preset="crt-9300k"]');
assert(await panel.inputValue('#target') === 'crt-9300k' && await panel.getAttribute('[data-preset="crt-9300k"]', 'aria-pressed') === 'true', 'quick preset selects the target');
await panel.click('#tab-pixel');
assert(await panel.isVisible('#bits') && !(await panel.isVisible('#luminance')), 'tabs switch the visible characteristics');
await panel.click('#tab-light');
await panel.click('[data-view="diff"]');
assert(await panel.getAttribute('[data-view="diff"]', 'aria-pressed') === 'true', 'difference view selectable');
await panel.click('[data-view="side"]');
await panel.selectOption('#target', 'budget-tn');

assert(!(await panel.isHidden('#preview-wrap')), 'the preview fills in automatically when the panel opens');
await panel.click('#capture');
await panel.waitForFunction(() => /^Preview \d+×\d+/.test(document.getElementById('sim-status')!.textContent!), null, { timeout: 20000 });
assert(true, 'Capture refreshes the original/simulated preview');
await panel.waitForFunction(() => /Live check on this page/.test(document.getElementById('accuracy')!.textContent!), null, { timeout: 20000 });
const acc = (await panel.textContent('#accuracy'))!;
console.log(`  ${acc}`);
assert(/: (9[89]|100)\.\d% of pixels/.test(acc), 'live self-check: ≥98% of pixels match the exact model in Chromium');
await panel.click('[data-preset="mono-lcd"]');
await new Promise(r => setTimeout(r, 300));
assert(await panel.isChecked('#mono') && await target.evaluate(() => !!document.querySelector('#phosphor-live feColorMatrix[color-interpolation-filters="sRGB"]')),
  'black-and-white preset turns the page monochrome');
await panel.selectOption('#target', 'budget-tn');

panel.once('dialog', (d: any) => d.accept('Ward 4B monitor'));
await panel.click('#save');
await panel.waitForSelector('#target option[value="ward-4b-monitor"]', { state: 'attached' });
assert(true, 'saving a custom profile adds it under "My profiles"');
if (shots) {
  await panel.screenshot({ path: join(shots, 'panel.png'), fullPage: true });
  await panel.evaluate(() => document.documentElement.classList.add('dark'));
  await panel.screenshot({ path: join(shots, 'panel-dark.png'), fullPage: true });
  await panel.setViewportSize({ width: 1750, height: 900 });
  await panel.screenshot({ path: join(shots, 'panel-dark-wide.png'), fullPage: true });
  await panel.evaluate(() => document.documentElement.classList.remove('dark'));
}

await panel.click('label.switch'); // users click the switch, not the hidden checkbox
await new Promise(r => setTimeout(r, 300));
const restored = await target.evaluate(() => [document.documentElement.style.getPropertyValue('filter'), document.documentElement.style.getPropertyValue('min-height'), !!document.getElementById('phosphor-live')]);
assert(restored[0] === '' && restored[1] === '50px' && !restored[2], 'turning live off restores the page exactly (its own inline styles too)');

await panel.click('label.switch'); await new Promise(r => setTimeout(r, 300));
assert(/Live is off/.test(await panel.textContent('#sim-status') ?? '') === false, 'status no longer says live is off once re-enabled');
await panel.close();
await new Promise(r => setTimeout(r, 800));
assert(await target.evaluate(() => !document.getElementById('phosphor-live')), 'closing DevTools removes the live filter');
assert(errors.length === 0, `no panel errors${errors.length ? ': ' + errors.join('; ') : ''}`);

await ctx.close(); server.close();
