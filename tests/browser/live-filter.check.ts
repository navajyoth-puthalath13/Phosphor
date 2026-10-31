// Measures the live SVG filter in a real Chromium against the CPU engine on the clinical test page.
// Run: node tests/browser/live-filter.check.ts   (needs Playwright + Chromium; not part of `npm test`)
import { createRequire } from 'node:module';
import { PNG } from 'pngjs';
import { compileFilter } from '../../engines/display-reproduction/filter.ts';
import { applyLive } from '../../apps/devtools-extension/live.ts';
import { resolveParams, simulate } from '../../engines/display-reproduction/pipeline.ts';
import { TARGETS } from '../../packages/display-profiles/targets.ts';

const { chromium } = createRequire(import.meta.url)('playwright');
const page = await (await chromium.launch()).newPage({ viewport: { width: 640, height: 400 } });
await page.goto(new URL('../fixtures/clinical-ui.html', import.meta.url).href);
const original = PNG.sync.read(await page.screenshot());
const ctx = { whiteNits: 400, mode: 'absolute' as const };

let failed = false;
for (const t of TARGETS) {
  const f = compileFilter(resolveParams(t, ctx).p);
  await page.evaluate(`(${applyLive})(${JSON.stringify(f.steps)}, 'phosphor-live')`); // exactly what the panel runs
  const live = PNG.sync.read(await page.screenshot());
  const cpu = simulate(original.data, t, ctx).data;
  let diffs: number[] = [];
  for (let i = 0; i < cpu.length; i += 4) diffs.push(Math.max(...[0, 1, 2].map(c => Math.abs(cpu[i + c] - live.data[i + c]))));
  // Text edges re-rasterise under a filter (anti-aliasing changes, not colour); report them separately.
  const ref = original.data; let edge = 0;
  const isEdge = (i: number) => { const x = (i / 4) % 640; return x > 0 && x < 639 && [4, -4, 2560, -2560].some(o => Math.abs(ref[i] - (ref[i + o] ?? ref[i])) > 24); };
  for (let i = 0, j = 0; i < cpu.length; i += 4, j++) if (isEdge(i)) { diffs[j] = -1; edge++; }
  diffs = diffs.filter(d => d >= 0);
  diffs.sort((a, b) => a - b);
  const p99 = diffs[Math.floor(diffs.length * 0.99)], max = diffs[diffs.length - 1];
  const within2 = diffs.filter(d => d <= 2).length / diffs.length;
  console.log(`${t.id.padEnd(22)} flat areas ≤2/255: ${(within2 * 100).toFixed(2)}%   p99 ${p99}   max ${max}   (${edge} edge px excluded)`);
  if (within2 < 0.99) failed = true;
}
process.exit(failed ? 1 : 0);
