// The Phosphor DevTools panel. Every control edits a working copy of the selected target profile; the same
// engine code drives both the live page filter and the exact captured preview.

import type { Primaries, Sourced, SourceDisplayProfile, TargetDisplayProfile } from '../../packages/profile-schema/index.ts';
import { resolveParams, simulate, whiteFitScale, EFFECTS, type Effect } from '../../engines/display-reproduction/pipeline.ts';
import { compileFilter } from '../../engines/display-reproduction/filter.ts';
import { TARGETS, NTSC45, SMPTE_C } from '../../packages/display-profiles/targets.ts';
import { validateTarget } from '../../packages/display-profiles/validate.ts';
import { SRGB, DISPLAY_P3, ADOBE_RGB, REC2020, cctFromXY, daylightXY } from '../../packages/colour-math/index.ts';
import { applyLive, removeLive, LIVE_ID } from './live.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const tabId = chrome.devtools.inspectedWindow.tabId;
chrome.runtime.connect({ name: `phosphor-panel:${tabId}` }); // lets the background restore the page when DevTools closes
if (chrome.devtools.panels.themeName === 'dark') document.documentElement.classList.add('dark');

const GAMUTS: Record<string, Primaries> = { srgb: SRGB, p3: DISPLAY_P3, adobe: ADOBE_RGB, rec2020: REC2020, ntsc45: NTSC45, smptec: SMPTE_C };
const user = <T>(value: T, unit?: string): Sourced<T> => ({ value, source: 'user', confidence: 'medium', unit, note: 'set in the Phosphor panel' });

let custom: TargetDisplayProfile[] = [];
let base: TargetDisplayProfile = TARGETS.find(t => t.id === 'budget-tn')!;
let work: TargetDisplayProfile = structuredClone(base);
const enabled = new Set<Effect>(EFFECTS);
let viewerNits: number | null = null;
let live = false;
let preview: { original: ImageData } | null = null;

// ---------- persistence ----------

async function load() {
  const s = await chrome.storage.local.get(['custom', 'viewerNits', 'mode', 'targetId']);
  custom = ((s.custom as unknown[]) ?? []).flatMap(t => { try { return [validateTarget(t)]; } catch { return []; } });
  viewerNits = typeof s.viewerNits === 'number' ? s.viewerNits : null;
  $<HTMLSelectElement>('mode').value = s.mode === 'adapted' ? 'adapted' : 'absolute';
  base = [...TARGETS, ...custom].find(t => t.id === s.targetId) ?? base;
  work = structuredClone(base);
}
const save = (patch: Record<string, unknown>) => chrome.storage.local.set(patch);

// ---------- your display (Engine 1, via the native helper) ----------

async function detect() {
  const r = await chrome.runtime.sendMessage({ type: 'detect' }) as { profiles?: SourceDisplayProfile[]; error?: string };
  const status = $('source-status');
  if (!r?.profiles) {
    status.textContent = r?.error ?? 'Native helper not connected. Run `phosphor setup` in Terminal.';
    status.className = 'status warn';
    return;
  }
  const p = r.profiles.find(d => d.identity.main) ?? r.profiles[0];
  if (!p) { status.textContent = 'No displays reported.'; return; }
  status.textContent = `Detected by the Phosphor helper${r.profiles.length > 1 ? ` (${r.profiles.length} displays; showing the main one)` : ''}.`;
  status.className = 'status';
  const c = p.characteristics, wp = c.whitePoint.value;
  const facts: [string, string, string?][] = [
    ['Display', p.identity.name.value ?? 'unnamed'],
    ['Resolution', `${p.geometry.pixels.width}×${p.geometry.pixels.height}`],
    ['Colour profile', p.colourProfile?.description ?? 'none'],
    ['Gamut', c.gamut.value ? gamutName(c.gamut.value) : 'unknown', c.gamut.source],
    ['White point', wp ? `${Math.round(cctFromXY(wp) / 50) * 50} K` : 'unknown', c.whitePoint.source],
    ['Framebuffer', c.framebufferBitsPerComponent.value ? `${c.framebufferBitsPerComponent.value}-bit` : 'unknown', c.framebufferBitsPerComponent.source],
    ['Unknown', (['luminance', 'contrastRatio', 'panelBitsPerComponent', 'chroma'] as const).filter(k => c[k].value == null)
      .map(k => ({ luminance: 'brightness', contrastRatio: 'contrast', panelBitsPerComponent: 'panel bit depth', chroma: 'picture-mode saturation' })[k]).join(', ')],
  ];
  $('source-facts').replaceChildren(...facts.flatMap(([k, v, src]) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    if (src && src !== 'unknown') dd.append(tag(src));
    return [dt, dd];
  }));
  if (viewerNits == null && c.luminance.value != null) { viewerNits = c.luminance.value; $<HTMLInputElement>('viewer-nits').value = String(viewerNits); update(); }
}

const tag = (text: string) => Object.assign(document.createElement('span'), { className: 'tag', textContent: text });
const near = (a: Primaries, b: Primaries) => (['red', 'green', 'blue'] as const).every(k => Math.abs(a[k].x - b[k].x) + Math.abs(a[k].y - b[k].y) < 0.003);
const gamutKey = (p: Primaries) => Object.keys(GAMUTS).find(k => near(GAMUTS[k], p)) ?? 'custom';
const gamutName = (p: Primaries) => ($<HTMLSelectElement>('gamut').querySelector(`option[value="${gamutKey(p)}"]`)?.textContent ?? 'custom').replace('…', '');

// ---------- target selector and controls ----------

function fillTargets() {
  const sel = $<HTMLSelectElement>('target');
  const group = (label: string, list: TargetDisplayProfile[]) => {
    const g = document.createElement('optgroup'); g.label = label;
    for (const t of list) g.append(new Option(t.name, t.id, false, t.id === base.id));
    return g;
  };
  sel.replaceChildren(group('Generic displays', TARGETS), ...(custom.length ? [group('My profiles', custom)] : []));
}

function render() {
  const v = <T>(s: Sourced<T>) => s.value;
  const set = (id: string, value: string | number) => { ($(id) as HTMLInputElement).value = String(value); };
  set('luminance', v(work.luminance) ?? 250);
  const cr = v(work.contrastRatio);
  set('contrast', cr == null || cr >= 1e6 ? 6 : Math.log10(cr));
  const prim = v(work.primaries) ?? SRGB;
  set('gamut', gamutKey(prim));
  $('gamut-custom').hidden = gamutKey(prim) !== 'custom';
  for (const inp of $('gamut-custom').querySelectorAll<HTMLInputElement>('input')) {
    const [c, k] = inp.dataset.p!.split('.') as ['red' | 'green' | 'blue', 'x' | 'y'];
    inp.value = prim[c][k].toFixed(4);
  }
  const tone = v(work.toneResponse);
  $<HTMLInputElement>('srgb-curve').checked = tone?.type === 'srgb';
  $<HTMLInputElement>('gamma').disabled = tone?.type === 'srgb';
  set('gamma', tone?.type === 'gamma' ? tone.gamma : 2.2);
  set('white', Math.round(cctFromXY(v(work.whitePoint) ?? daylightXY(6504)) / 100) * 100);
  set('bits', v(work.bitDepth) ?? 8);
  $<HTMLInputElement>('frc').checked = work.dithering === 'frc';
  set('chroma', v(work.chroma) ?? 1);
  $<HTMLInputElement>('managed').checked = work.colourManaged;
  $('delete').hidden = !custom.some(t => t.id === base.id);
  $('target-notes').textContent = [`${base.technology}${base.backlight ? `, ${base.backlight} backlight` : ''}.`, ...base.assumptions].join(' ');
  outputs();
}

function outputs() {
  const out = (id: string, text: string, s?: Sourced<unknown>) => { const o = $(`${id}-out`); o.textContent = text; if (s) o.append(tag(s.source)); };
  out('luminance', `${work.luminance.value} cd/m²`, work.luminance);
  const cr = work.contrastRatio.value;
  out('contrast', cr == null || cr >= 1e6 ? 'ideal' : `${Math.round(cr).toLocaleString()}:1`, work.contrastRatio);
  out('gamut', '', work.primaries);
  const tone = work.toneResponse.value;
  out('gamma', tone?.type === 'gamma' ? tone.gamma.toFixed(2) : 'sRGB', work.toneResponse);
  out('white', `${Math.round(cctFromXY(work.whitePoint.value!) / 50) * 50} K`, work.whitePoint);
  out('bits', `${work.bitDepth.value}-bit${work.dithering === 'frc' ? '+FRC' : ''}`, work.bitDepth);
  out('chroma', `${work.chroma.value?.toFixed(2)}×`, work.chroma);
  for (const e of EFFECTS) document.querySelector(`.ctl[data-effect="${e}"]`)!.classList.toggle('off', !enabled.has(e));
}

function wire() {
  const on = (id: string, ev: string, fn: (el: any) => void) => $(id).addEventListener(ev, () => { fn($(id)); outputs(); update(); });
  on('luminance', 'input', el => (work.luminance = user(+el.value, 'cd/m²')));
  on('contrast', 'input', el => (work.contrastRatio = user(+el.value >= 5.99 ? 1e6 : Math.round(10 ** +el.value), ':1')));
  on('gamut', 'change', el => {
    if (el.value !== 'custom') work.primaries = user(structuredClone(GAMUTS[el.value]), 'CIE 1931 xy');
    $('gamut-custom').hidden = el.value !== 'custom';
  });
  $('gamut-custom').addEventListener('change', () => {
    const p = structuredClone(work.primaries.value ?? SRGB);
    for (const inp of $('gamut-custom').querySelectorAll<HTMLInputElement>('input')) {
      const [c, k] = inp.dataset.p!.split('.') as ['red' | 'green' | 'blue', 'x' | 'y'];
      p[c][k] = +inp.value;
    }
    try { validateTarget({ ...work, primaries: user(p) }); work.primaries = user(p, 'CIE 1931 xy'); }
    catch { status('Those primaries don\'t form a valid gamut (each x, y in 0–1 with x + y ≤ 1).', 'err'); return; }
    outputs(); update();
  });
  on('gamma', 'input', el => (work.toneResponse = user({ type: 'gamma' as const, gamma: +el.value })));
  on('srgb-curve', 'change', el => {
    work.toneResponse = user(el.checked ? { type: 'srgb' as const } : { type: 'gamma' as const, gamma: +$<HTMLInputElement>('gamma').value });
    $<HTMLInputElement>('gamma').disabled = el.checked;
  });
  on('white', 'input', el => (work.whitePoint = user(daylightXY(+el.value), 'CIE 1931 xy')));
  on('bits', 'change', el => (work.bitDepth = user(+el.value, 'bits')));
  on('frc', 'change', el => (work.dithering = el.checked ? 'frc' : 'none'));
  on('chroma', 'input', el => (work.chroma = user(+el.value)));
  on('managed', 'change', el => (work.colourManaged = el.checked));
  on('mode', 'change', el => save({ mode: el.value }));
  on('viewer-nits', 'change', el => { viewerNits = el.value && +el.value > 0 ? +el.value : null; save({ viewerNits }); });
  for (const e of EFFECTS) on(`on-${e}`, 'change', el => (el.checked ? enabled.add(e) : enabled.delete(e)));

  $('target').addEventListener('change', () => {
    base = [...TARGETS, ...custom].find(t => t.id === $<HTMLSelectElement>('target').value)!;
    work = structuredClone(base);
    save({ targetId: base.id }); render(); update();
  });
  $('reset').addEventListener('click', () => { work = structuredClone(base); render(); update(); });
  $('save').addEventListener('click', saveCustom);
  $('delete').addEventListener('click', async () => {
    if (!confirm(`Delete "${base.name}"?`)) return;
    custom = custom.filter(t => t.id !== base.id);
    await save({ custom });
    base = TARGETS[0]; work = structuredClone(base); fillTargets(); render(); update();
  });
  $('export').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(work, null, 2)], { type: 'application/json' }));
    a.download = `${work.id}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $<HTMLInputElement>('import').addEventListener('change', async e => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const t = validateTarget(JSON.parse(await file.text()));
      if (TARGETS.some(b => b.id === t.id)) t.id = `my-${t.id}`;
      await addCustom(t);
      status(`Imported "${t.name}".`);
    } catch (err) { status((err as Error).message, 'err'); }
    (e.target as HTMLInputElement).value = '';
  });

  $<HTMLInputElement>('live').addEventListener('change', e => {
    live = (e.target as HTMLInputElement).checked;
    $<HTMLButtonElement>('hold').disabled = !live;
    if (live) applyNow(); else evalInPage(`(${removeLive})(${JSON.stringify(LIVE_ID)})`);
    update();
  });
  const hold = $('hold');
  const down = () => live && evalInPage(`(${removeLive})(${JSON.stringify(LIVE_ID)})`);
  const up = () => live && applyNow();
  hold.addEventListener('pointerdown', down);
  for (const ev of ['pointerup', 'pointerleave']) hold.addEventListener(ev, up);
  hold.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) down(); });
  hold.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') up(); });
  $('capture').addEventListener('click', capture);
  $('split').addEventListener('input', drawPreview);
  chrome.devtools.network.onNavigated.addListener(() => { if (live) setTimeout(applyNow, 300); });
}

async function saveCustom() {
  const name = prompt('Name for this display profile (e.g. "Ward 4B monitor")', work.technology === 'custom' ? work.name : `${base.name} (edited)`)?.trim();
  if (!name) return;
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 56) || 'my-display';
  const t = { ...structuredClone(work), id: TARGETS.some(b => b.id === id) ? `my-${id}` : id, name, technology: 'custom' as const,
    assumptions: [...new Set([...base.assumptions, `Edited from "${base.name}".`])] };
  try { await addCustom(validateTarget(JSON.parse(JSON.stringify(t)))); status(`Saved "${name}".`); }
  catch (e) { status((e as Error).message, 'err'); }
}

async function addCustom(t: TargetDisplayProfile) {
  custom = [...custom.filter(c => c.id !== t.id), t];
  await save({ custom, targetId: t.id });
  base = t; work = structuredClone(t); fillTargets(); render(); update();
}

// ---------- simulation ----------

function params() {
  const r = resolveParams(work, { whiteNits: viewerNits, mode: $<HTMLSelectElement>('mode').value as 'absolute' | 'adapted' }, enabled);
  const scale = whiteFitScale(r.p);
  if (scale < 0.995) r.warnings.push(`the target's white is outside your display's; everything is scaled to ${(scale * 100).toFixed(0)}% to keep colours in proportion`);
  return r;
}

const evalInPage = (code: string) => chrome.devtools.inspectedWindow.eval(code, (_r: unknown, exc: chrome.devtools.inspectedWindow.EvaluationExceptionInfo) => {
  if (exc?.isException || exc?.isError) status(`Couldn't change this page: ${exc.value ?? exc.description}`, 'err');
});
const applyNow = () => evalInPage(`(${applyLive})(${JSON.stringify(compileFilter(params().p).steps)}, ${JSON.stringify(LIVE_ID)})`);

let timer: ReturnType<typeof setTimeout> | undefined;
function update() {
  const { p, warnings } = params();
  const notes = live ? compileFilter(p).approximations.map(a => `Live: ${a}.`) : [];
  status([...warnings.map(w => `${w[0].toUpperCase()}${w.slice(1)}.`), ...notes].join(' ') || (live ? 'Live on page.' : ''), warnings.length ? 'warn' : '');
  if (live) applyNow();
  if (preview) { clearTimeout(timer); timer = setTimeout(simulatePreview, 200); }
}

function status(text: string, kind: '' | 'warn' | 'err' = '') {
  const s = $('sim-status'); s.textContent = text; s.className = `status ${kind}`;
}

async function capture() {
  status('Capturing…');
  if (live) { evalInPage(`(${removeLive})(${JSON.stringify(LIVE_ID)})`); await new Promise(r => setTimeout(r, 150)); } // let the page repaint unfiltered
  const r = await chrome.runtime.sendMessage({ type: 'capture', tabId }) as { dataUrl?: string; error?: string };
  if (live) applyNow();
  if (!r?.dataUrl) { status(`Capture failed: ${r?.error ?? 'no image'}. Click the page once, then try again.`, 'err'); return; }
  const img = new Image(); img.src = r.dataUrl; await img.decode();
  const c = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
  const ctx = c.getContext('2d', { colorSpace: 'srgb' })!; // the browser converts a tagged capture to sRGB here
  ctx.drawImage(img, 0, 0);
  preview = { original: ctx.getImageData(0, 0, c.width, c.height, { colorSpace: 'srgb' }) };
  $('preview-wrap').hidden = false;
  simulatePreview();
}

let simulated: ImageData | null = null;
function simulatePreview() {
  if (!preview) return;
  const { width, height, data } = preview.original;
  const t0 = performance.now();
  const r = simulate(data, work, { whiteNits: viewerNits, mode: $<HTMLSelectElement>('mode').value as 'absolute' | 'adapted' }, enabled);
  simulated = new ImageData(r.data, width, height);
  drawPreview();
  const extra = r.outOfGamutPixels ? ` ${r.outOfGamutPixels.toLocaleString()} px were outside sRGB and gamut-mapped.` : '';
  status(`Preview ${width}×${height} simulated in ${Math.round(performance.now() - t0)} ms.${extra}`);
}

function drawPreview() {
  if (!preview || !simulated) return;
  const canvas = $<HTMLCanvasElement>('preview');
  const { width, height } = preview.original;
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const x = Math.round(width * +$<HTMLInputElement>('split').value / 100);
  ctx.putImageData(preview.original, 0, 0);
  ctx.putImageData(simulated, 0, 0, x, 0, width - x, height);
  ctx.fillStyle = '#fff'; ctx.fillRect(x - 1, 0, 2, height);
}

// ---------- start ----------

await load();
$<HTMLInputElement>('viewer-nits').value = viewerNits == null ? '' : String(viewerNits);
fillTargets(); render(); wire(); update();
detect();
