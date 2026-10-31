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
document.documentElement.classList.toggle('dark', chrome.devtools.panels.themeName === 'dark');

const GAMUTS: Record<string, Primaries> = { srgb: SRGB, p3: DISPLAY_P3, adobe: ADOBE_RGB, rec2020: REC2020, ntsc45: NTSC45, smptec: SMPTE_C };
const user = <T>(value: T, unit?: string): Sourced<T> => ({ value, source: 'user', confidence: 'medium', unit, note: 'set in the Phosphor panel' });

let custom: TargetDisplayProfile[] = [];
let base: TargetDisplayProfile = TARGETS.find(t => t.id === 'budget-tn')!;
let work: TargetDisplayProfile = structuredClone(base);
const enabled = new Set<Effect>(EFFECTS);
let viewerNits: number | null = null;
let live = true; // on by default: changing a control should visibly change the page
let view: 'side' | 'split' | 'diff' = 'side';
let original: ImageData | null = null;
let simulated: ImageData | null = null;

// ---------- persistence ----------

async function load() {
  const s = await chrome.storage.local.get(['custom', 'viewerNits', 'mode', 'targetId', 'live', 'view']);
  live = s.live !== false;
  $<HTMLInputElement>('live').checked = live;
  $<HTMLButtonElement>('hold').disabled = !live;
  if (s.view === 'split' || s.view === 'diff') view = s.view;
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
  const badge = $('source-badge'), status = $('source-status');
  if (!r?.profiles?.length) {
    badge.textContent = 'Not connected'; badge.className = 'badge warn';
    status.textContent = r?.error ?? 'Run `phosphor setup` in Terminal.';
    return;
  }
  const p = r.profiles.find(d => d.identity.main) ?? r.profiles[0];
  badge.textContent = 'Detected'; badge.className = 'badge ok';
  status.textContent = `Detected by Phosphor helper${r.profiles.length > 1 ? ` (main of ${r.profiles.length} displays)` : ''}.`;
  const c = p.characteristics, wp = c.whitePoint.value;
  const facts: [string, string, string?][] = [
    ['Display', p.identity.name.value ?? 'unnamed'],
    ['Resolution', `${p.geometry.pixels.width} × ${p.geometry.pixels.height}`],
    ['Colour profile', p.colourProfile?.description ?? 'none'],
    ['Gamut', c.gamut.value ? gamutName(c.gamut.value) : 'unknown', c.gamut.source],
    ['White point', wp ? `${Math.round(cctFromXY(wp) / 50) * 50} K` : 'unknown', c.whitePoint.source],
    ['Framebuffer', c.framebufferBitsPerComponent.value ? `${c.framebufferBitsPerComponent.value}-bit` : 'unknown', c.framebufferBitsPerComponent.source],
    ['Unknown', 'Brightness, contrast, panel bit depth and picture-mode saturation: no software can read them.'],
  ];
  $('source-facts').replaceChildren(...facts.flatMap(([k, v, src]) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    if (src && src !== 'unknown') dd.append(tag(src.toUpperCase()));
    return [dt, dd];
  }));
  if (viewerNits == null && c.luminance.value != null) { viewerNits = c.luminance.value; $<HTMLInputElement>('viewer-nits').value = String(viewerNits); update(); }
}

const tag = (text: string) => Object.assign(document.createElement('span'), { className: 'tag', textContent: text });
const near = (a: Primaries, b: Primaries) => (['red', 'green', 'blue'] as const).every(k => Math.abs(a[k].x - b[k].x) + Math.abs(a[k].y - b[k].y) < 0.003);
const gamutKey = (p: Primaries) => Object.keys(GAMUTS).find(k => near(GAMUTS[k], p)) ?? 'custom';
const gamutName = (p: Primaries) => ($<HTMLSelectElement>('gamut').querySelector(`option[value="${gamutKey(p)}"]`)?.textContent ?? 'Custom').replace(/ \(.*\)$/, '');

// ---------- target, presets, controls ----------

function fillTargets() {
  const group = (label: string, list: TargetDisplayProfile[]) => {
    const g = document.createElement('optgroup'); g.label = label;
    for (const t of list) g.append(new Option(t.name, t.id, false, t.id === base.id));
    return g;
  };
  $('target').replaceChildren(group('Generic displays', TARGETS), ...(custom.length ? [group('My profiles', custom)] : []));
}

function selectTarget(id: string) {
  base = [...TARGETS, ...custom].find(t => t.id === id) ?? base;
  work = structuredClone(base);
  save({ targetId: base.id }); fillTargets(); render(); update();
}

/** A slider and a number field bound to one characteristic. Slider scale may differ (contrast is logarithmic). */
interface Pair { id: string; get(): number; set(v: number): void; toSlider?(v: number): number; fromSlider?(s: number): number; digits: number }
const PAIRS: Pair[] = [
  { id: 'luminance', digits: 0, get: () => work.luminance.value ?? 250, set: v => (work.luminance = user(v, 'cd/m²')) },
  { id: 'contrast', digits: 0, get: () => Math.min(work.contrastRatio.value ?? 1e6, 1e6), set: v => (work.contrastRatio = user(v, ':1')),
    toSlider: v => Math.log10(v), fromSlider: s => Math.round(10 ** s) },
  { id: 'white', digits: 0, get: () => Math.round(cctFromXY(work.whitePoint.value ?? daylightXY(6504)) / 50) * 50, set: v => (work.whitePoint = user(daylightXY(v), 'CIE 1931 xy')) },
  { id: 'gamma', digits: 2, get: () => { const t = work.toneResponse.value; return t?.type === 'gamma' ? t.gamma : 2.2; }, set: v => (work.toneResponse = user({ type: 'gamma' as const, gamma: v })) },
  { id: 'chroma', digits: 2, get: () => work.chroma.value ?? 1, set: v => (work.chroma = user(v)) },
];

function paintSlider(el: HTMLInputElement) {
  el.style.setProperty('--fill', `${((+el.value - +el.min) / (+el.max - +el.min)) * 100}%`);
}

function render() {
  for (const p of PAIRS) {
    const v = p.get(), slider = $<HTMLInputElement>(p.id);
    slider.value = String(p.toSlider ? p.toSlider(v) : v); paintSlider(slider);
    $<HTMLInputElement>(`${p.id}-num`).value = v.toFixed(p.digits);
  }
  const srgbCurve = work.toneResponse.value?.type === 'srgb';
  $<HTMLInputElement>('srgb-curve').checked = srgbCurve;
  for (const id of ['gamma', 'gamma-num']) $<HTMLInputElement>(id).disabled = srgbCurve;
  const prim = work.primaries.value ?? SRGB;
  $<HTMLSelectElement>('gamut').value = gamutKey(prim);
  for (const inp of $('gamut-custom').querySelectorAll<HTMLInputElement>('input')) {
    const [c, k] = inp.dataset.p!.split('.') as ['red' | 'green' | 'blue', 'x' | 'y'];
    inp.value = prim[c][k].toFixed(4);
  }
  $<HTMLSelectElement>('bits').value = String(work.bitDepth.value ?? 8);
  $<HTMLInputElement>('frc').checked = work.dithering === 'frc';
  $<HTMLInputElement>('managed').checked = work.colourManaged;
  $('delete').hidden = !custom.some(t => t.id === base.id);
  $('target-notes').querySelector('span')!.textContent = [`${base.technology}${base.backlight ? `, ${base.backlight} backlight` : ''}.`, ...base.assumptions].join(' ');
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-preset]')) b.setAttribute('aria-pressed', String(b.dataset.preset === base.id));
  $('sim-caption').textContent = `Simulated display (${work.name})`;
  tags();
}

function tags() {
  for (const t of document.querySelectorAll<HTMLElement>('[data-src]')) t.textContent = (work as any)[t.dataset.src!]?.source ?? '';
  for (const e of EFFECTS) document.querySelector(`.ctl[data-effect="${e}"]`)!.classList.toggle('off', !enabled.has(e));
}

function wire() {
  const changed = () => { tags(); update(); };
  for (const p of PAIRS) {
    const slider = $<HTMLInputElement>(p.id), num = $<HTMLInputElement>(`${p.id}-num`);
    slider.addEventListener('input', () => {
      const v = p.fromSlider ? p.fromSlider(+slider.value) : +slider.value;
      p.set(v); num.value = v.toFixed(p.digits); paintSlider(slider); changed();
    });
    num.addEventListener('change', () => {
      const v = Math.min(Math.max(+num.value, +num.min), +num.max);
      if (!Number.isFinite(v)) { num.value = p.get().toFixed(p.digits); return; }
      p.set(v); num.value = v.toFixed(p.digits);
      slider.value = String(p.toSlider ? p.toSlider(v) : v); paintSlider(slider); changed();
    });
  }
  const on = (id: string, ev: string, fn: (el: any) => void) => $(id).addEventListener(ev, () => { fn($(id)); changed(); });
  on('srgb-curve', 'change', el => {
    work.toneResponse = user(el.checked ? { type: 'srgb' as const } : { type: 'gamma' as const, gamma: +$<HTMLInputElement>('gamma-num').value });
    for (const id of ['gamma', 'gamma-num']) $<HTMLInputElement>(id).disabled = el.checked;
  });
  on('gamut', 'change', el => {
    if (el.value === 'custom') { showTab('advanced'); return; }
    work.primaries = user(structuredClone(GAMUTS[el.value]), 'CIE 1931 xy'); render();
  });
  $('gamut-custom').addEventListener('change', () => {
    const p = structuredClone(work.primaries.value ?? SRGB);
    for (const inp of $('gamut-custom').querySelectorAll<HTMLInputElement>('input')) {
      const [c, k] = inp.dataset.p!.split('.') as ['red' | 'green' | 'blue', 'x' | 'y'];
      p[c][k] = +inp.value;
    }
    try { validateTarget({ ...work, primaries: user(p) }); }
    catch { status('Those primaries don\'t form a valid gamut (each x, y in 0–1 with x + y ≤ 1).', 'err'); return; }
    work.primaries = user(p, 'CIE 1931 xy'); render(); update();
  });
  on('bits', 'change', el => (work.bitDepth = user(+el.value, 'bits')));
  on('frc', 'change', el => (work.dithering = el.checked ? 'frc' : 'none'));
  on('managed', 'change', el => (work.colourManaged = el.checked));
  on('mode', 'change', el => save({ mode: el.value }));
  on('viewer-nits', 'change', el => { viewerNits = el.value && +el.value > 0 ? +el.value : null; save({ viewerNits }); });
  for (const e of EFFECTS) on(`on-${e}`, 'change', el => (el.checked ? enabled.add(e) : enabled.delete(e)));

  $('target').addEventListener('change', () => selectTarget($<HTMLSelectElement>('target').value));
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-preset]')) b.addEventListener('click', () => selectTarget(b.dataset.preset!));
  $('reset').addEventListener('click', () => { work = structuredClone(base); render(); update(); });
  $('save').addEventListener('click', saveCustom);
  $('delete').addEventListener('click', async () => {
    if (!confirm(`Delete "${base.name}"?`)) return;
    custom = custom.filter(t => t.id !== base.id);
    await save({ custom });
    selectTarget(TARGETS[0].id);
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

  // Tabs (WAI-ARIA tabs pattern: arrow keys move between tabs).
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role=tab]')];
  for (const t of tabs) {
    t.addEventListener('click', () => showTab(t.id.slice(4)));
    t.addEventListener('keydown', e => {
      const i = tabs.indexOf(t), next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
      if (next == null) return;
      const n = tabs[(next + tabs.length) % tabs.length]; showTab(n.id.slice(4)); n.focus();
    });
  }

  $<HTMLInputElement>('live').addEventListener('change', e => {
    live = (e.target as HTMLInputElement).checked;
    save({ live });
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

  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-view]')) b.addEventListener('click', () => { view = b.dataset.view as typeof view; save({ view }); drawPreview(); });
  $('capture').addEventListener('click', capture);
  $('split').addEventListener('input', drawPreview);
  $('fullscreen').addEventListener('click', () => $('preview-wrap').requestFullscreen().catch(() => {}));
  chrome.devtools.network.onNavigated.addListener(() => { if (live) setTimeout(applyNow, 300); });
}

function showTab(name: string) {
  for (const t of document.querySelectorAll<HTMLButtonElement>('[role=tab]')) {
    const on = t.id === `tab-${name}`;
    t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
    $(t.getAttribute('aria-controls')!).hidden = !on;
  }
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
  const off = live ? [] : ['Live is off: the page isn\'t changing. Turn on "Live on page", or use the preview.'];
  status([...off, ...warnings.map(w => `${w[0].toUpperCase()}${w.slice(1)}.`), ...notes].join(' ') || 'Live on page.', warnings.length || !live ? 'warn' : '');
  if (live) applyNow();
  if (original) { clearTimeout(timer); timer = setTimeout(simulatePreview, 150); }
}

function status(text: string, kind: '' | 'warn' | 'err' = '') {
  const s = $('sim-status'); s.textContent = text; s.className = `status ${kind}`;
}

async function capture() {
  status('Capturing…');
  if (live) { evalInPage(`(${removeLive})(${JSON.stringify(LIVE_ID)})`); await new Promise(r => setTimeout(r, 150)); } // let the page repaint unfiltered
  const r = await chrome.runtime.sendMessage({ type: 'capture', tabId }) as { dataUrl?: string; error?: string };
  if (live) applyNow();
  if (!r?.dataUrl) { status(`Capture failed: ${r?.error ?? 'no image'}. Click the page once, then press Capture.`, 'err'); return; }
  const img = new Image(); img.src = r.dataUrl; await img.decode();
  const c = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
  const ctx = c.getContext('2d', { colorSpace: 'srgb' })!; // the browser converts a tagged capture to sRGB here
  ctx.drawImage(img, 0, 0);
  original = ctx.getImageData(0, 0, c.width, c.height, { colorSpace: 'srgb' });
  $('preview-wrap').hidden = false;
  simulatePreview();
}

function simulatePreview() {
  if (!original) return;
  const t0 = performance.now();
  const r = simulate(original.data, work, { whiteNits: viewerNits, mode: $<HTMLSelectElement>('mode').value as 'absolute' | 'adapted' }, enabled);
  simulated = new ImageData(r.data, original.width, original.height);
  drawPreview();
  if (!live) return; // keep the "live is off" message visible
  const extra = r.outOfGamutPixels ? ` ${r.outOfGamutPixels.toLocaleString()} px were outside sRGB and gamut-mapped.` : '';
  status(`Preview ${original.width}×${original.height} in ${Math.round(performance.now() - t0)} ms.${extra}`);
}

function drawPreview() {
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  $('preview-wrap').classList.toggle('single', view !== 'side');
  $('split-row').hidden = view !== 'split';
  if (!original || !simulated) return;
  const { width, height } = original;
  const put = (id: string, img: ImageData) => { const c = $<HTMLCanvasElement>(id); c.width = width; c.height = height; c.getContext('2d')!.putImageData(img, 0, 0); return c; };
  if (view === 'side') { put('view-a', original); put('view-b', simulated); return; }
  if (view === 'split') {
    const c = put('view-b', original), ctx = c.getContext('2d')!, x = Math.round(width * +$<HTMLInputElement>('split').value / 100);
    ctx.putImageData(simulated, 0, 0, x, 0, width - x, height);
    ctx.fillStyle = '#fff'; ctx.fillRect(x - 1, 0, 2, height);
    return;
  }
  // Difference: where the target changes the picture, amplified ×4 so small shifts are visible.
  const d = new ImageData(width, height);
  for (let i = 0; i < d.data.length; i += 4) {
    for (let k = 0; k < 3; k++) d.data[i + k] = Math.min(255, Math.abs(original.data[i + k] - simulated.data[i + k]) * 4);
    d.data[i + 3] = 255;
  }
  put('view-b', d);
}

// ---------- start ----------

await load();
$<HTMLInputElement>('viewer-nits').value = viewerNits == null ? '' : String(viewerNits);
fillTargets(); render(); wire(); drawPreview();
detect();
await capture(); // fills the preview straight away; capture() applies live mode afterwards
update();
