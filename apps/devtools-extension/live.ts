// Functions that run *inside the inspected page*. They must stay self-contained (no imports, no closures):
// DevTools serialises them with toString() for inspectedWindow.eval, and scripting.executeScript sends them as-is.
// The SVG is built with DOM APIs, not innerHTML, so pages that enforce Trusted Types still work.

import type { FilterStep } from '../../engines/display-reproduction/filter.ts';

export const LIVE_ID = 'phosphor-live';

export function applyLive(steps: FilterStep[], id: string): void {
  const NS = 'http://www.w3.org/2000/svg';
  const root = document.documentElement;
  let host = document.getElementById(id);
  if (!host) {
    host = document.createElement('div');
    host.id = id;
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    host.dataset.filter = root.style.getPropertyValue('filter');
    host.dataset.minHeight = root.style.getPropertyValue('min-height');
    root.appendChild(host);
  }
  const el = (tag: string, attrs: Record<string, string>) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  const svg = el('svg', { width: '0', height: '0' });
  const filter = el('filter', { id: `${id}-filter`, 'color-interpolation-filters': 'sRGB', x: '0', y: '0', width: '100%', height: '100%' });
  for (const s of steps) {
    if (s.type === 'table') {
      const ct = el('feComponentTransfer', {});
      for (const c of ['R', 'G', 'B']) ct.appendChild(el(`feFunc${c}`, { type: 'table', tableValues: s.values.join(' ') }));
      filter.appendChild(ct);
    } else if (s.type === 'matrix') {
      filter.appendChild(el('feColorMatrix', { type: 'matrix', 'color-interpolation-filters': 'linearRGB', values: s.values.join(' ') }));
    } else {
      filter.appendChild(el('feColorMatrix', { type: 'saturate', values: String(s.value) }));
    }
  }
  svg.appendChild(filter);
  host.replaceChildren(svg);
  root.style.setProperty('filter', `url(#${id}-filter)`, 'important');
  root.style.setProperty('min-height', '100vh'); // a filtered root stops painting its background below short pages
}

export function removeLive(id: string): void {
  const host = document.getElementById(id);
  if (!host) return;
  const root = document.documentElement;
  for (const [prop, saved] of [['filter', host.dataset.filter], ['min-height', host.dataset.minHeight]] as const) {
    if (saved) root.style.setProperty(prop, saved); else root.style.removeProperty(prop);
  }
  host.remove();
}
